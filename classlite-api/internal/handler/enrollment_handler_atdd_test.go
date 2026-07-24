// Story 3.4.5 — EnrollmentHandler integration tests (TEST-BE-3: real middleware,
// real service, real DB via the committed raw pool). Covers AC2/AC3/AC5/AC6:
//   - owner/admin enroll an existing student → 201 + full {data,meta} envelope
//   - Teacher/Student caller → 403 INSUFFICIENT_ROLE (role re-fetched from
//     center_members, not the JWT claim — SEC-1)
//   - enrolling a non-student member → 422 NOT_A_STUDENT_MEMBER
//   - double active enrollment → 409 ALREADY_ENROLLED
//   - class not in center → 404 CLASS_NOT_FOUND
//   - unauthenticated → 401
//   - roster: teacher of own class → 200; teacher of another class → 404;
//     owner center-wide → 200; student → 403
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// decodeEnrollmentList unmarshals a {data:[…],meta} roster envelope.
func decodeEnrollmentList(t *testing.T, rec *httptest.ResponseRecorder) classListEnvelope {
	t.Helper()
	var out classListEnvelope
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode roster envelope: %v (body: %s)", err, rec.Body.String())
	}
	return out
}

type enrollmentTestEnv struct {
	srv           http.Handler
	centerID      string
	classAID      uuid.UUID // owned by teacher A
	classBID      uuid.UUID // owned by teacher B
	student1ID    pgtype.UUID
	student1Email string
	student2ID    pgtype.UUID
	teacherBID    pgtype.UUID // a NON-student member (for the 422 case)
	ownerTok      string
	adminTok      string
	teacherATok   string
	teacherBTok   string
	studentTok    string
}

func setupEnrollmentHandlerTest(t *testing.T) enrollmentTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	admin := test.CreateUserOnPool(t, pool, "admin-"+sfx+"@example.com", "Admin")
	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	student1 := test.CreateUserOnPool(t, pool, "s1-"+sfx+"@example.com", "Alice Student")
	student2 := test.CreateUserOnPool(t, pool, "s2-"+sfx+"@example.com", "Bob Student")
	for _, u := range []test.User{owner, admin, teacherA, teacherB, student1, student2} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, admin.ID, "admin")
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student1.ID, "student")
	test.AddCenterMember(t, pool, centerPg, student2.ID, "student")

	taID := test.UUIDString(teacherA.ID)
	tbID := test.UUIDString(teacherB.ID)
	classA := test.SeedClass(t, centerID, "Class A", "active", &taID, nil)
	classB := test.SeedClass(t, centerID, "Class B", "active", &tbID, nil)

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = 'enrollment'`)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, admin, teacherA, teacherB, student1, student2} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})

	return enrollmentTestEnv{
		srv:           test.NewEnrollmentTestServerBareMux(t, pool),
		centerID:      centerID,
		classAID:      classA,
		classBID:      classB,
		student1ID:    student1.ID,
		student1Email: "s1-" + sfx + "@example.com",
		student2ID:    student2.ID,
		teacherBID:    teacherB.ID,
		ownerTok:      test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		adminTok:      test.SignAccessTokenForRole(t, admin.ID, centerID, "admin"),
		teacherATok:   test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok:   test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:    test.SignAccessTokenForRole(t, student1.ID, centerID, "student"),
	}
}

func createBody(env enrollmentTestEnv, studentID pgtype.UUID, classID uuid.UUID) map[string]any {
	return map[string]any{
		"studentId": test.UUIDString(studentID),
		"classId":   classID.String(),
	}
}

// =============================================================================
// AC2 — Owner/Admin can enroll an existing student
// =============================================================================
func TestEnrollment_Create_OwnerEnrollsStudent_201(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusCreated {
		t.Fatalf("owner POST → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["status"] != "active" {
		t.Errorf("status = %v, want active", got.Data["status"])
	}
	if got.Data["studentName"] != "Alice Student" {
		t.Errorf("studentName = %v, want Alice Student (joined from users)", got.Data["studentName"])
	}
	if got.Data["studentId"] != test.UUIDString(env.student1ID) {
		t.Errorf("studentId = %v, want %s", got.Data["studentId"], test.UUIDString(env.student1ID))
	}
	if got.Meta.ServerTime == "" {
		t.Error("envelope missing meta.serverTime")
	}
}

func TestEnrollment_Create_AdminEnrollsStudent_201(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.adminTok,
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusCreated {
		t.Fatalf("admin POST → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// SEC-1 regression — a STALE/ELEVATED JWT does not grant access. teacherB is a
// `teacher` member in center_members but is handed an `owner`-role token; the DB
// role re-fetch must still 403. This is the scenario the DB re-validation exists
// for (demotion within the 15-min access-token window, EDGE-2) — the two 403
// tests below sign tokens whose JWT role matches the DB role, so only THIS test
// proves the DB read is the deciding factor rather than the JWT claim.
// =============================================================================
func TestEnrollment_Create_StaleOwnerJWTForTeacher_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	forgedOwnerTok := test.SignAccessTokenForRole(t, env.teacherBID, env.centerID, "owner")
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", forgedOwnerTok,
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner-claim JWT for a DB teacher → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE (role re-validated from center_members, not the JWT)", code)
	}
}

// =============================================================================
// AC2/AC5 — Teacher/Student callers are 403 (role re-validated from DB)
// =============================================================================
func TestEnrollment_Create_TeacherForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.teacherATok,
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher POST → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

func TestEnrollment_Create_StudentForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.studentTok,
		createBody(env, env.student2ID, env.classAID))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student POST → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

// =============================================================================
// AC2 — enrolling a NON-student member → 422 NOT_A_STUDENT_MEMBER
// =============================================================================
func TestEnrollment_Create_NonStudentMember_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// teacherB is a member, but role=teacher — not a student.
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.teacherBID, env.classAID))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("enroll non-student → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_A_STUDENT_MEMBER" {
		t.Errorf("error code = %q, want NOT_A_STUDENT_MEMBER", code)
	}
}

// =============================================================================
// AC2 — a studentId that is NOT a student member of the caller's center → 422.
// Two boundaries distinct from the same-center staff-role case above:
//
//	(a) an unknown user (member of no center / random UUID)
//	(b) a student who belongs to a DIFFERENT center (cross-tenant)
//
// IsStudentMemberOfCenter is scoped to the caller's center, so both are 422.
// =============================================================================
func TestEnrollment_Create_UnknownUser_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	body := map[string]any{
		"studentId": uuid.NewString(), // not a member of any center
		"classId":   env.classAID.String(),
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("enroll unknown user → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_A_STUDENT_MEMBER" {
		t.Errorf("error code = %q, want NOT_A_STUDENT_MEMBER", code)
	}
}

func TestEnrollment_Create_CrossTenantStudent_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)

	// Build a second center B with its own `student` member, directly via the
	// superuser pool (NOT CreateUserOnPool — that holds a dedicated pooled
	// connection per user for an advisory lock, and setup already holds several;
	// two more would exhaust the pool and deadlock). Center A's owner must NOT be
	// able to enroll a student who belongs to Center B — IsStudentMemberOfCenter
	// is scoped to the caller's center, so the cross-tenant student is a non-member
	// there → 422 NOT_A_STUDENT_MEMBER.
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	studentBID := uuid.New()
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (id, email, full_name, email_verified) VALUES ($1, $2, $3, true)`,
		studentBID, "sB-"+sfx+"@example.com", "Student B"); err != nil {
		t.Fatalf("insert cross-tenant student: %v", err)
	}
	var centerBID string
	if err := sp.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1, $2) RETURNING id`,
		"Center B", "cb-"+sfx).Scan(&centerBID); err != nil {
		t.Fatalf("insert center B: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1, $2, 'student')`,
		studentBID, centerBID); err != nil {
		t.Fatalf("add student to center B: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerBID)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBID)
		_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, studentBID)
	})

	body := map[string]any{
		"studentId": studentBID.String(),
		"classId":   env.classAID.String(),
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("enroll cross-tenant student → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_A_STUDENT_MEMBER" {
		t.Errorf("error code = %q, want NOT_A_STUDENT_MEMBER", code)
	}
}

// =============================================================================
// Body validation — every response code the route advertises has a negative test.
//   - non-UUID studentId → 422 VALIDATION_ERROR
//   - body > maxEnrollmentBodyBytes (16 KiB) → 413 PAYLOAD_TOO_LARGE
//
// =============================================================================
func TestEnrollment_Create_NonUUIDStudentId_422(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	body := map[string]any{
		"studentId": "not-a-uuid",
		"classId":   env.classAID.String(),
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, body)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("non-UUID studentId → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
}

func TestEnrollment_Create_OversizedBody_413(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// A studentId value well past the 16 KiB cap trips MaxBytesReader during decode.
	body := map[string]any{
		"studentId": strings.Repeat("a", 20*1024),
		"classId":   env.classAID.String(),
	}
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok, body)
	if rec.Code != http.StatusRequestEntityTooLarge {
		t.Fatalf("oversized body → %d, want 413 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "PAYLOAD_TOO_LARGE" {
		t.Errorf("error code = %q, want PAYLOAD_TOO_LARGE", code)
	}
}

// =============================================================================
// GO-5 — the 201 body carries withdrawnAt as an explicit null (key present, not
// omitted) and the denormalized studentEmail from the users join.
// =============================================================================
func TestEnrollment_Create_ResponseExplicitNullsAndEmail_201(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusCreated {
		t.Fatalf("owner POST → %d, want 201 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if v, ok := got.Data["withdrawnAt"]; !ok {
		t.Error("response missing withdrawnAt key — GO-5 requires an explicit null, not an omitted field")
	} else if v != nil {
		t.Errorf("withdrawnAt = %v, want null on a fresh active enrollment", v)
	}
	if got.Data["studentEmail"] != env.student1Email {
		t.Errorf("studentEmail = %v, want %s (joined from users)", got.Data["studentEmail"], env.student1Email)
	}
}

// =============================================================================
// AC4 — double enrollment → 409 ALREADY_ENROLLED
// =============================================================================
func TestEnrollment_Create_AlreadyEnrolled_409(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	first := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, env.classAID))
	if first.Code != http.StatusCreated {
		t.Fatalf("first enroll → %d, want 201 (body: %s)", first.Code, first.Body.String())
	}
	second := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, env.classAID))
	if second.Code != http.StatusConflict {
		t.Fatalf("second enroll → %d, want 409 (body: %s)", second.Code, second.Body.String())
	}
	if code := errCodeOf(t, second.Body.Bytes()); code != "ALREADY_ENROLLED" {
		t.Errorf("error code = %q, want ALREADY_ENROLLED", code)
	}
}

// =============================================================================
// AC2 — class not in caller's center → 404 CLASS_NOT_FOUND
// =============================================================================
func TestEnrollment_Create_ClassNotInCenter_404(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
		createBody(env, env.student1ID, uuid.New()))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("unknown class → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "CLASS_NOT_FOUND" {
		t.Errorf("error code = %q, want CLASS_NOT_FOUND", code)
	}
}

// =============================================================================
// unauthenticated → 401
// =============================================================================
func TestEnrollment_Create_Unauthenticated_401(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", "",
		createBody(env, env.student1ID, env.classAID))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token → %d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// =============================================================================
// AC3 — roster read: teacher of own class → 200 with enrolled students
// =============================================================================
func TestEnrollment_List_TeacherOwnClass_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// Arrange: owner enrolls two students into class A (teacher A's class).
	for _, sid := range []pgtype.UUID{env.student1ID, env.student2ID} {
		rec := classReq(t, env.srv, http.MethodPost, "/api/enrollments", env.ownerTok,
			createBody(env, sid, env.classAID))
		if rec.Code != http.StatusCreated {
			t.Fatalf("arrange enroll → %d (body: %s)", rec.Code, rec.Body.String())
		}
	}

	rec := classReq(t, env.srv, http.MethodGet, "/api/classes/"+env.classAID.String()+"/enrollments", env.teacherATok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("teacher roster (own class) → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	list := decodeEnrollmentList(t, rec)
	if len(list.Data) != 2 {
		t.Fatalf("roster length = %d, want 2", len(list.Data))
	}
	// ORDER BY full_name ASC → Alice before Bob.
	if list.Data[0]["studentName"] != "Alice Student" {
		t.Errorf("first roster entry = %v, want Alice Student (ordered by name)", list.Data[0]["studentName"])
	}
	// Roster rows carry the denormalized studentEmail from the users join.
	if list.Data[0]["studentEmail"] != env.student1Email {
		t.Errorf("first roster studentEmail = %v, want %s (joined from users)", list.Data[0]["studentEmail"], env.student1Email)
	}
}

// =============================================================================
// AC3 — teacher of ANOTHER class → 404 CLASS_NOT_FOUND (teacher-sees-nothing)
// =============================================================================
func TestEnrollment_List_TeacherOtherClass_404(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	// teacher A asks for class B's roster (teacher B's class).
	rec := classReq(t, env.srv, http.MethodGet, "/api/classes/"+env.classBID.String()+"/enrollments", env.teacherATok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("teacher roster (other class) → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "CLASS_NOT_FOUND" {
		t.Errorf("error code = %q, want CLASS_NOT_FOUND", code)
	}
}

// =============================================================================
// AC3 — owner sees any class in-center → 200
// =============================================================================
func TestEnrollment_List_OwnerAnyClass_200(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/classes/"+env.classBID.String()+"/enrollments", env.ownerTok, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner roster (any class) → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	list := decodeEnrollmentList(t, rec)
	if len(list.Data) != 0 {
		t.Errorf("empty class B roster length = %d, want 0 (empty roster still 200)", len(list.Data))
	}
}

// =============================================================================
// AC3 — student caller → 403 INSUFFICIENT_ROLE
// =============================================================================
func TestEnrollment_List_StudentForbidden_403(t *testing.T) {
	env := setupEnrollmentHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/classes/"+env.classAID.String()+"/enrollments", env.studentTok, nil)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student roster → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}
