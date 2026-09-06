// Story 3.5b (AC5b/AC7/AC9/AC10 · D5/D6/D12/D14 · risk=6) — AttendanceHandler
// integration tests (TEST-BE-3: real middleware, real service, real DB via the
// committed raw pool). The authz + bulk-atomicity contract, verified against the
// SAME semantics the shipped session_content_handler_atdd_test.go proves for the
// sibling endpoints:
//   - non-owning teacher → 404 SESSION_NOT_FOUND (teacher-sees-nothing, NOT 403)
//   - student caller → 403 INSUFFICIENT_ROLE (in-service assertClassRole)
//   - attendance recordable on CANCELLED + PAST sessions (no status/time gate, D14)
//   - PUT for a non-enrolled studentId → 422 NOT_ENROLLED
//   - bulk with one bad id LAST → 422 + zero rows written (validate-all-before-write, D6)
//
// GREEN (Story 3.5b landed): the build tag was removed once the server seam
// test.NewAttendanceTestServerBareMux + the handler/routes shipped, so these run
// in normal CI as the permanent authz + bulk-atomicity regression suite (was
// red-phase behind `//go:build atdd_red_phase`).
//
// SEAMS this suite locks (dev — Task 4 service + Task 5 handler/routes):
//
//	NewAttendanceTestServerBareMux(t, pool) http.Handler  -- wires the 3 routes on
//	  the sessionChain (extractTenant→requireVerified→requireCenter; NO RequireRole)
//	GET  /api/sessions/{id}/attendance          → {data:{roster:[…]}}
//	PUT  /api/sessions/{id}/attendance/{sid}     body {status}          → entry
//	POST /api/sessions/{id}/attendance/bulk      body {status,studentIds?} → roster

package handler_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

type attendanceTestEnv struct {
	srv          http.Handler
	centerID     string
	centerPg     any
	sessionAID   uuid.UUID // class A (teacher A), scheduled
	cancelledID  uuid.UUID // class A, status='cancelled'
	sessionBID   uuid.UUID // class B (teacher B)
	enrolledSID  uuid.UUID // active enrollment in class A
	strangerSID  uuid.UUID // a student NOT enrolled in class A
	teacherATok  string
	teacherBTok  string
	studentTok   string
}

func attendancePath(id uuid.UUID) string { return "/api/sessions/" + id.String() + "/attendance" }
func attendanceStudentPath(id, sid uuid.UUID) string {
	return "/api/sessions/" + id.String() + "/attendance/" + sid.String()
}
func attendanceBulkPath(id uuid.UUID) string {
	return "/api/sessions/" + id.String() + "/attendance/bulk"
}

func seedAttendanceSession(t *testing.T, centerID string, classID uuid.UUID, startsAt time.Time, status string) uuid.UUID {
	t.Helper()
	id := uuid.New()
	sp := test.SuperuserPool(t)
	var cancelledAt any
	if status == "cancelled" {
		cancelledAt = startsAt
	}
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO sessions (id, center_id, class_id, topic, starts_at, ends_at, status, cancelled_at)
		 VALUES ($1, $2::uuid, $3, 'Topic', $4::timestamptz, $4::timestamptz + interval '90 minutes', $5, $6)`,
		id, centerID, classID, startsAt, status, cancelledAt,
	); err != nil {
		t.Fatalf("seed session (%s): %v", status, err)
	}
	return id
}

func seedActiveEnrollment(t *testing.T, centerID string, studentID, classID uuid.UUID) {
	t.Helper()
	sp := test.SuperuserPool(t)
	if _, err := sp.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status)
		 VALUES ($1, $2::uuid, $3, $4, 'active')`,
		uuid.New(), centerID, studentID, classID,
	); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func setupAttendanceHandlerTest(t *testing.T) attendanceTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	teacherA := test.CreateUserOnPool(t, pool, "ta-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "tb-"+sfx+"@example.com", "Teacher B")
	enrolled := test.CreateUserOnPool(t, pool, "en-"+sfx+"@example.com", "Enrolled Student")
	stranger := test.CreateUserOnPool(t, pool, "sx-"+sfx+"@example.com", "Stranger Student")
	for _, u := range []test.User{owner, teacherA, teacherB, enrolled, stranger} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, enrolled.ID, "student")
	test.AddCenterMember(t, pool, centerPg, stranger.ID, "student")

	taID := test.UUIDString(teacherA.ID)
	tbID := test.UUIDString(teacherB.ID)
	classA := test.SeedClass(t, centerID, "Class A", "active", &taID, nil)
	classB := test.SeedClass(t, centerID, "Class B", "active", &tbID, nil)

	enrolledSID := uuid.UUID(enrolled.ID.Bytes)
	seedActiveEnrollment(t, centerID, enrolledSID, classA)

	past := time.Now().Add(-48 * time.Hour)
	env := attendanceTestEnv{
		centerID:    centerID,
		centerPg:    centerPg,
		sessionAID:  seedAttendanceSession(t, centerID, classA, past, "scheduled"),
		cancelledID: seedAttendanceSession(t, centerID, classA, past, "cancelled"),
		sessionBID:  seedAttendanceSession(t, centerID, classB, past, "scheduled"),
		enrolledSID: enrolledSID,
		strangerSID: uuid.UUID(stranger.ID.Bytes),
		teacherATok: test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok: test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:  test.SignAccessTokenForRole(t, enrolled.ID, centerID, "student"),
	}
	// GREEN SEAM — NewAttendanceTestServerBareMux does not exist yet (compile-red).
	env.srv = test.NewAttendanceTestServerBareMux(t, pool)

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM attendance WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM sessions WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		for _, u := range []test.User{owner, teacherA, teacherB, enrolled, stranger} {
			test.PurgeUserAndOwnedCenters(t, pool, u.ID)
		}
	})
	return env
}

// =============================================================================
// AC10 — a teacher who is NOT the class's teacher gets 404 SESSION_NOT_FOUND
// (teacher-sees-nothing convention — NOT 403). Mirrors session_content.
// =============================================================================
func TestAttendance_NonOwningTeacher_404(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	// teacherB is denied on EVERY attendance verb for class A's session → 404
	// SESSION_NOT_FOUND (never 403). Assert the body code, not just the status —
	// a bare 404 could equally be a routing miss (AC10 mandates the code).
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"GET", http.MethodGet, attendancePath(env.sessionAID), nil},
		{"PUT", http.MethodPut, attendanceStudentPath(env.sessionAID, env.enrolledSID), map[string]any{"status": "present"}},
		{"bulk", http.MethodPost, attendanceBulkPath(env.sessionAID), map[string]any{"status": "present"}},
	}
	for _, tc := range cases {
		rec := classReq(t, env.srv, tc.method, tc.path, env.teacherBTok, tc.body)
		if rec.Code != http.StatusNotFound {
			t.Errorf("non-owning teacher %s: got %d, want 404 (body: %s)", tc.name, rec.Code, rec.Body.String())
		}
		if code := errCodeOf(t, rec.Body.Bytes()); code != "SESSION_NOT_FOUND" {
			t.Errorf("non-owning teacher %s: error code = %q, want SESSION_NOT_FOUND (teacher-sees-nothing, not 403)", tc.name, code)
		}
	}
}

// =============================================================================
// AC10 — a student gets 403 INSUFFICIENT_ROLE (in-service assertClassRole,
// NOT a sessionChain allowlist) on every attendance verb.
// =============================================================================
func TestAttendance_Student_403(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"GET", http.MethodGet, attendancePath(env.sessionAID), nil},
		{"PUT", http.MethodPut, attendanceStudentPath(env.sessionAID, env.enrolledSID), map[string]any{"status": "present"}},
		{"bulk", http.MethodPost, attendanceBulkPath(env.sessionAID), map[string]any{"status": "present"}},
	}
	for _, tc := range cases {
		rec := classReq(t, env.srv, tc.method, tc.path, env.studentTok, tc.body)
		if rec.Code != http.StatusForbidden {
			t.Errorf("student %s: got %d, want 403 (body: %s)", tc.name, rec.Code, rec.Body.String())
		}
		if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
			t.Errorf("student %s: error code = %q, want INSUFFICIENT_ROLE", tc.name, code)
		}
	}
}

// =============================================================================
// AC5b / D14 — the class's teacher CAN mark attendance on a CANCELLED session.
// =============================================================================
func TestAttendance_CancelledSessionAllowed(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPut, attendanceStudentPath(env.cancelledID, env.enrolledSID),
		env.teacherATok, map[string]any{"status": "present"})
	if rec.Code != http.StatusOK {
		t.Errorf("mark on cancelled session: got %d, want 200 (no status gate, D14)", rec.Code)
	}
}

// =============================================================================
// AC7 — PUT for a studentId not actively enrolled in the class → 422 NOT_ENROLLED.
// =============================================================================
func TestAttendance_NotEnrolled_422(t *testing.T) {
	env := setupAttendanceHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPut, attendanceStudentPath(env.sessionAID, env.strangerSID),
		env.teacherATok, map[string]any{"status": "present"})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("PUT non-enrolled student: got %d, want 422 NOT_ENROLLED", rec.Code)
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_ENROLLED" {
		t.Errorf("PUT non-enrolled student: error code = %q, want NOT_ENROLLED", code)
	}
}

// countAttendanceRows asserts the whole bulk batch rolled back — zero attendance
// rows for the session — proving validate-ALL-before-write atomicity.
func countAttendanceRows(t *testing.T, sessionID uuid.UUID) int {
	t.Helper()
	sp := test.SuperuserPool(t)
	var count int
	if err := sp.QueryRow(context.Background(),
		"SELECT count(*) FROM attendance WHERE session_id = $1", sessionID,
	).Scan(&count); err != nil {
		t.Fatalf("count attendance after failed bulk: %v", err)
	}
	return count
}

// =============================================================================
// AC9 / D6 — bulk with one bad id positioned LAST → 422 and ZERO rows written
// (validate-ALL-before-write, not upsert-then-check). The bad-id-last position
// is load-bearing: it catches a validate-as-you-go implementation.
// =============================================================================
func TestAttendance_BulkOneBadIdLast_ZeroWrites(t *testing.T) {
	env := setupAttendanceHandlerTest(t)

	rec := classReq(t, env.srv, http.MethodPost, attendanceBulkPath(env.sessionAID),
		env.teacherATok, map[string]any{
			"status":     "present",
			"studentIds": []string{env.enrolledSID.String(), env.strangerSID.String()}, // valid, then BAD (last)
		})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("bulk with bad id last: got %d, want 422 NOT_ENROLLED", rec.Code)
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_ENROLLED" {
		t.Errorf("bulk with bad id last: error code = %q, want NOT_ENROLLED", code)
	}
	if count := countAttendanceRows(t, env.sessionAID); count != 0 {
		t.Errorf("ATOMICITY VIOLATION: %d rows written after a rejected bulk, want 0 (validate-all-before-write)", count)
	}
}

// =============================================================================
// AC9 / D6 — bulk with one bad id positioned in the MIDDLE → 422 and ZERO rows
// written. Complements bad-id-last: together they prove the reject is
// position-independent (validate-ALL-before-any-upsert), not merely "check the
// last id" or "stop at the first". The valid id is repeated after the bad one so
// a would-be write exists past the rejection point with the current fixtures.
// =============================================================================
func TestAttendance_BulkOneBadIdMiddle_ZeroWrites(t *testing.T) {
	env := setupAttendanceHandlerTest(t)

	rec := classReq(t, env.srv, http.MethodPost, attendanceBulkPath(env.sessionAID),
		env.teacherATok, map[string]any{
			"status":     "present",
			"studentIds": []string{env.enrolledSID.String(), env.strangerSID.String(), env.enrolledSID.String()}, // valid, BAD (middle), valid
		})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("bulk with bad id middle: got %d, want 422 NOT_ENROLLED", rec.Code)
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "NOT_ENROLLED" {
		t.Errorf("bulk with bad id middle: error code = %q, want NOT_ENROLLED", code)
	}
	if count := countAttendanceRows(t, env.sessionAID); count != 0 {
		t.Errorf("ATOMICITY VIOLATION: %d rows written after a rejected bulk, want 0 (validate-all-before-write)", count)
	}
}
