// Story 3.1 — ClassHandler integration tests (TEST-BE-3: real middleware, real
// service, real DB via the committed raw pool). Covers Task 9 handler bullets:
//   - create → 201 upcoming + full {data,meta} envelope (AC1)
//   - owner/admin create MUST assign a teacher → 422 (AC1)
//   - teacher create defaults teacher_id to self → 201 (AC1)
//   - List owner = all vs teacher = own only (other teacher ABSENT) (AC5)
//   - GET single 200 / unknown id 404 (AC6)
//   - PATCH teacher-on-another-teacher's-class → 404 CLASS_NOT_FOUND (AC6)
//   - status legal 200 / illegal 422 INVALID_STATUS_TRANSITION /
//     garbage 422 INVALID_STATUS (AC4 + party-mode)
//   - unauthenticated → 401
package handler_test

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

type classTestEnv struct {
	srv         http.Handler
	centerID    string
	teacherAID  pgtype.UUID
	teacherBID  pgtype.UUID
	ownerTok    string
	teacherATok string
	teacherBTok string
	studentTok  string
}

func setupClassHandlerTest(t *testing.T) classTestEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)

	teacherA := test.CreateUserOnPool(t, pool, "teachera-"+sfx+"@example.com", "Teacher A")
	teacherB := test.CreateUserOnPool(t, pool, "teacherb-"+sfx+"@example.com", "Teacher B")
	student := test.CreateUserOnPool(t, pool, "student-"+sfx+"@example.com", "Student S")
	test.MarkUserEmailVerifiedOnPool(t, pool, teacherA.ID)
	test.MarkUserEmailVerifiedOnPool(t, pool, teacherB.ID)
	test.MarkUserEmailVerifiedOnPool(t, pool, student.ID)
	test.AddCenterMember(t, pool, centerPg, teacherA.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, teacherB.ID, "teacher")
	// A verified student member reaches the classChain (not owner-gated) —
	// ExtractTenant reads role='student' from center_members, so the service
	// role allowlist (AC1) is the sole gate on the mutating endpoints.
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	t.Cleanup(func() {
		sp := test.SuperuserPool(t)
		ctx := context.Background()
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = 'class' AND entity_id IN (SELECT id::text FROM classes WHERE center_id = $1::uuid)`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM classes WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE center_id = $1`, centerPg)
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerPg)
		test.PurgeUserAndOwnedCenters(t, pool, owner.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherA.ID)
		test.PurgeUserAndOwnedCenters(t, pool, teacherB.ID)
		test.PurgeUserAndOwnedCenters(t, pool, student.ID)
	})

	return classTestEnv{
		srv:         test.NewClassTestServerBareMux(t, pool),
		centerID:    centerID,
		teacherAID:  teacherA.ID,
		teacherBID:  teacherB.ID,
		ownerTok:    test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		teacherATok: test.SignAccessTokenForRole(t, teacherA.ID, centerID, "teacher"),
		teacherBTok: test.SignAccessTokenForRole(t, teacherB.ID, centerID, "teacher"),
		studentTok:  test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

func classReq(t *testing.T, srv http.Handler, method, path, token string, body any) *httptest.ResponseRecorder {
	t.Helper()
	var r io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			t.Fatalf("marshal body: %v", err)
		}
		r = bytes.NewReader(b)
	}
	req := httptest.NewRequest(method, path, r)
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	return rec
}

type classEnvelope struct {
	Data map[string]any `json:"data"`
	Meta struct {
		ServerTime string `json:"serverTime"`
	} `json:"meta"`
}

type classListEnvelope struct {
	Data []map[string]any `json:"data"`
}

type errEnvelope struct {
	Error struct {
		Code      string `json:"code"`
		Message   string `json:"message"`
		RequestID string `json:"requestId"`
		Details   []struct {
			Field string `json:"field"`
			Code  string `json:"code"`
		} `json:"details"`
	} `json:"error"`
}

func decodeClassEnvelope(t *testing.T, rec *httptest.ResponseRecorder) classEnvelope {
	t.Helper()
	var env classEnvelope
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v — body: %s", err, rec.Body.String())
	}
	return env
}

// AC1 — create → 201 upcoming + full envelope, dueDatesEnabled false.
func TestClassHandler_Create_AC01_OwnerAssignsTeacher_Upcoming(t *testing.T) {
	env := setupClassHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/classes", env.ownerTok, map[string]any{
		"name":      "IELTS Cohort A",
		"teacherId": test.UUIDString(env.teacherAID),
		"capacity":  12,
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	e := decodeClassEnvelope(t, rec)
	if e.Meta.ServerTime == "" {
		t.Error("envelope meta.serverTime missing")
	}
	if e.Data["status"] != "upcoming" {
		t.Errorf("status = %v, want upcoming (server-forced)", e.Data["status"])
	}
	if e.Data["dueDatesEnabled"] != false {
		t.Errorf("dueDatesEnabled = %v, want false (AC3 default)", e.Data["dueDatesEnabled"])
	}
	if e.Data["teacherId"] != test.UUIDString(env.teacherAID) {
		t.Errorf("teacherId = %v, want %s", e.Data["teacherId"], test.UUIDString(env.teacherAID))
	}
	if e.Data["id"] == nil {
		t.Error("id missing from created class")
	}
}

// AC1 — owner/admin MUST assign a teacher (no auto-assign) → 422.
func TestClassHandler_Create_AC01_OwnerWithoutTeacher_422(t *testing.T) {
	env := setupClassHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/classes", env.ownerTok, map[string]any{
		"name": "Unassigned Cohort",
	})
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("want 422, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

// AC1 — teacher create defaults teacher_id to self.
func TestClassHandler_Create_AC01_TeacherDefaultsSelf(t *testing.T) {
	env := setupClassHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodPost, "/api/classes", env.teacherATok, map[string]any{
		"name": "Teacher A Self Cohort",
	})
	if rec.Code != http.StatusCreated {
		t.Fatalf("want 201, got %d — body: %s", rec.Code, rec.Body.String())
	}
	e := decodeClassEnvelope(t, rec)
	if e.Data["teacherId"] != test.UUIDString(env.teacherAID) {
		t.Errorf("teacherId = %v, want caller %s", e.Data["teacherId"], test.UUIDString(env.teacherAID))
	}
}

// AC5 — owner sees ALL center classes; teacher sees ONLY own (other ABSENT).
func TestClassHandler_List_AC05_RoleScoped(t *testing.T) {
	env := setupClassHandlerTest(t)
	aID := test.UUIDString(env.teacherAID)
	bID := test.UUIDString(env.teacherBID)
	test.SeedClass(t, env.centerID, "A-Class", "active", &aID, nil)
	test.SeedClass(t, env.centerID, "B-Class", "active", &bID, nil)

	ownerRec := classReq(t, env.srv, http.MethodGet, "/api/classes", env.ownerTok, nil)
	if ownerRec.Code != http.StatusOK {
		t.Fatalf("owner list want 200, got %d — %s", ownerRec.Code, ownerRec.Body.String())
	}
	var ownerList classListEnvelope
	_ = json.NewDecoder(ownerRec.Body).Decode(&ownerList)
	ownerNames := namesOf(ownerList.Data)
	if !ownerNames["A-Class"] || !ownerNames["B-Class"] {
		t.Errorf("owner must see both classes; got %v", ownerNames)
	}

	teacherRec := classReq(t, env.srv, http.MethodGet, "/api/classes", env.teacherATok, nil)
	if teacherRec.Code != http.StatusOK {
		t.Fatalf("teacher list want 200, got %d — %s", teacherRec.Code, teacherRec.Body.String())
	}
	var teacherList classListEnvelope
	_ = json.NewDecoder(teacherRec.Body).Decode(&teacherList)
	teacherNames := namesOf(teacherList.Data)
	if !teacherNames["A-Class"] {
		t.Errorf("teacher A must see own class; got %v", teacherNames)
	}
	if teacherNames["B-Class"] {
		t.Errorf("AC5 LEAK: teacher A sees teacher B's class; got %v", teacherNames)
	}
}

// AC6 — GET unknown id → 404 CLASS_NOT_FOUND.
func TestClassHandler_Get_AC06_UnknownID_404(t *testing.T) {
	env := setupClassHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/classes/"+uuid.NewString(), env.ownerTok, nil)
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404, got %d — %s", rec.Code, rec.Body.String())
	}
	var e errEnvelope
	_ = json.NewDecoder(rec.Body).Decode(&e)
	if e.Error.Code != "CLASS_NOT_FOUND" {
		t.Errorf("code = %q, want CLASS_NOT_FOUND", e.Error.Code)
	}
}

// AC6 — teacher PATCH on another teacher's class → 404 (teacher-sees-nothing).
func TestClassHandler_Update_AC06_TeacherOnOthersClass_404(t *testing.T) {
	env := setupClassHandlerTest(t)
	bID := test.UUIDString(env.teacherBID)
	classB := test.SeedClass(t, env.centerID, "B-Only", "upcoming", &bID, nil)

	rec := classReq(t, env.srv, http.MethodPatch, "/api/classes/"+classB.String(), env.teacherATok, map[string]any{
		"name": "Hijacked",
	})
	if rec.Code != http.StatusNotFound {
		t.Fatalf("want 404 (cross-teacher), got %d — %s", rec.Code, rec.Body.String())
	}
	var e errEnvelope
	_ = json.NewDecoder(rec.Body).Decode(&e)
	if e.Error.Code != "CLASS_NOT_FOUND" {
		t.Errorf("code = %q, want CLASS_NOT_FOUND (not 403)", e.Error.Code)
	}
}

// AC4 — legal transition 200; illegal 422 INVALID_STATUS_TRANSITION; garbage
// status 422 INVALID_STATUS (distinct shape, never reaches the map).
func TestClassHandler_TransitionStatus_AC04(t *testing.T) {
	env := setupClassHandlerTest(t)
	aID := test.UUIDString(env.teacherAID)
	classID := test.SeedClass(t, env.centerID, "Lifecycle", "upcoming", &aID, nil)
	path := "/api/classes/" + classID.String() + "/status"

	legal := classReq(t, env.srv, http.MethodPost, path, env.ownerTok, map[string]any{"status": "active"})
	if legal.Code != http.StatusOK {
		t.Fatalf("legal upcoming→active want 200, got %d — %s", legal.Code, legal.Body.String())
	}
	if e := decodeClassEnvelope(t, legal); e.Data["status"] != "active" {
		t.Errorf("after legal move status = %v, want active", e.Data["status"])
	}

	// active → ended is legal, but re-seed a fresh upcoming to test illegal
	// upcoming→ended path deterministically.
	classID2 := test.SeedClass(t, env.centerID, "Lifecycle2", "upcoming", &aID, nil)
	path2 := "/api/classes/" + classID2.String() + "/status"
	illegal := classReq(t, env.srv, http.MethodPost, path2, env.ownerTok, map[string]any{"status": "ended"})
	if illegal.Code != http.StatusUnprocessableEntity {
		t.Fatalf("illegal upcoming→ended want 422, got %d — %s", illegal.Code, illegal.Body.String())
	}
	var ie errEnvelope
	_ = json.NewDecoder(illegal.Body).Decode(&ie)
	if !hasDetailCode(ie, "status", "INVALID_STATUS_TRANSITION") {
		t.Errorf("illegal move details = %+v, want status/INVALID_STATUS_TRANSITION", ie.Error.Details)
	}

	garbage := classReq(t, env.srv, http.MethodPost, path2, env.ownerTok, map[string]any{"status": "deleted"})
	if garbage.Code != http.StatusUnprocessableEntity {
		t.Fatalf("garbage status want 422, got %d — %s", garbage.Code, garbage.Body.String())
	}
	var ge errEnvelope
	_ = json.NewDecoder(garbage.Body).Decode(&ge)
	if !hasDetailCode(ge, "status", "INVALID_STATUS") {
		t.Errorf("garbage status details = %+v, want status/INVALID_STATUS (distinct from transition)", ge.Error.Details)
	}
}

// Unauthenticated → 401.
func TestClassHandler_List_Unauthenticated_401(t *testing.T) {
	env := setupClassHandlerTest(t)
	rec := classReq(t, env.srv, http.MethodGet, "/api/classes", "", nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("want 401, got %d — %s", rec.Code, rec.Body.String())
	}
}

// AC1 role allowlist (CR-3-1 review, P1) — a verified `student` center member
// reaches the classChain (not owner-gated) but MUST be 403 INSUFFICIENT_ROLE on
// every class endpoint: List, Create, Get, Update, and status transition. The
// classChain has no middleware role gate, so the service allowlist is the sole
// defense — this is the regression the review found untested.
func TestClassHandler_Student_Forbidden_AllEndpoints(t *testing.T) {
	env := setupClassHandlerTest(t)
	aID := test.UUIDString(env.teacherAID)
	classID := test.SeedClass(t, env.centerID, "Gated Cohort", "upcoming", &aID, nil).String()

	cases := []struct {
		name, method, path string
		body               any
	}{
		{"list", http.MethodGet, "/api/classes", nil},
		{"create", http.MethodPost, "/api/classes", map[string]any{"name": "Student Cohort", "teacherId": aID}},
		{"get", http.MethodGet, "/api/classes/" + classID, nil},
		{"update", http.MethodPatch, "/api/classes/" + classID, map[string]any{"name": "Renamed By Student"}},
		{"transition", http.MethodPost, "/api/classes/" + classID + "/status", map[string]any{"status": "active"}},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := classReq(t, env.srv, tc.method, tc.path, env.studentTok, tc.body)
			if rec.Code != http.StatusForbidden {
				t.Fatalf("student %s %s: want 403, got %d — %s", tc.method, tc.path, rec.Code, rec.Body.String())
			}
			var e errEnvelope
			_ = json.NewDecoder(rec.Body).Decode(&e)
			if e.Error.Code != "INSUFFICIENT_ROLE" {
				t.Errorf("student %s: code = %q, want INSUFFICIENT_ROLE", tc.name, e.Error.Code)
			}
		})
	}
}

// CR-3-1 review P2 + P5 — targetBand outside 0–9 is a 422 (numeric(3,1) has no
// CHECK, so the service is the sole guard), and a well-formed-but-nonexistent
// teacherId trips the FK → mapped to 422, not a generic 500.
func TestClassHandler_Create_Validation_TargetBandAndBadRefs(t *testing.T) {
	env := setupClassHandlerTest(t)

	t.Run("targetBand_above_9_422", func(t *testing.T) {
		rec := classReq(t, env.srv, http.MethodPost, "/api/classes", env.ownerTok, map[string]any{
			"name": "Band Cohort", "teacherId": test.UUIDString(env.teacherAID), "targetBand": 50,
		})
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("targetBand=50: want 422, got %d — %s", rec.Code, rec.Body.String())
		}
		var e errEnvelope
		_ = json.NewDecoder(rec.Body).Decode(&e)
		if !hasDetailCode(e, "targetBand", "INVALID_TARGET_BAND") {
			t.Errorf("details = %+v, want targetBand/INVALID_TARGET_BAND", e.Error.Details)
		}
	})

	t.Run("nonexistent_teacherId_422_not_500", func(t *testing.T) {
		rec := classReq(t, env.srv, http.MethodPost, "/api/classes", env.ownerTok, map[string]any{
			"name": "Ghost Teacher Cohort", "teacherId": uuid.NewString(),
		})
		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("nonexistent teacherId: want 422, got %d — %s", rec.Code, rec.Body.String())
		}
	})
}

func namesOf(rows []map[string]any) map[string]bool {
	out := map[string]bool{}
	for _, r := range rows {
		if n, ok := r["name"].(string); ok {
			out[n] = true
		}
	}
	return out
}

func hasDetailCode(e errEnvelope, field, code string) bool {
	for _, d := range e.Error.Details {
		if d.Field == field && d.Code == code {
			return true
		}
	}
	return false
}
