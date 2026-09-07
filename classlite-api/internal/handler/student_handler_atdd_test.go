// Story 7.2a (AC3/AC7/AC8/AC12/AC13/AC14/AC16 · D11 · risk=7) — the student HTTP
// surface authz EDGE (real middleware chain): student→403 on every verb, the
// ★ teacher out-of-scope 404 NON-DISCLOSURE (never 403), the author-or-owner
// note-delete guard, and empty-content 422. These ride the shipped RequireRole
// middleware around the net-new student routes; the substance is that the routes
// are wired to the RIGHT gate and that teacher-scope leaks as 404, not 403.
//
// package handler_test — reuses errorEnvelope + newReqWithRequestID.
//
// RED (`//go:build atdd_red_phase`): compile-fails on the GREENFIELD test-server
// seam test.NewStudentTestServerForRole (dev adds it mirroring
// NewStaffTestServerForRole) and the greenfield student routes/service.
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

// --- local seeds (raw SQL over the test tx; tenant context set by the caller) ---

func stuMember(t *testing.T, db *test.TxDB, centerID pgtype.UUID, email, role string) pgtype.UUID {
	t.Helper()
	u := test.CreateUser(t, db, email, role+" "+email)
	test.CreateCenterMember(t, db, u.ID, centerID, role)
	return u.ID
}

func stuClass(t *testing.T, db *test.TxDB, centerID, teacherID pgtype.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO classes (id, center_id, name, status, teacher_id) VALUES ($1,$2,'C','active',$3)`,
		id, centerID, teacherID); err != nil {
		t.Fatalf("seed class: %v", err)
	}
	return id
}

func stuEnroll(t *testing.T, db *test.TxDB, centerID, studentID pgtype.UUID, classID uuid.UUID) {
	t.Helper()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO enrollments (id, center_id, student_id, class_id, status) VALUES ($1,$2,$3,$4,'active')`,
		uuid.New(), centerID, studentID, classID); err != nil {
		t.Fatalf("seed enrollment: %v", err)
	}
}

func stuNote(t *testing.T, db *test.TxDB, centerID, studentID, authorID pgtype.UUID) uuid.UUID {
	t.Helper()
	id := uuid.New()
	if _, err := db.Exec(context.Background(),
		`INSERT INTO student_notes (id, center_id, student_id, author_id, content) VALUES ($1,$2,$3,$4,'note')`,
		id, centerID, studentID, authorID); err != nil {
		t.Fatalf("seed note: %v", err)
	}
	return id
}

// AC3/AC8/AC13 — a STUDENT caller is 403 INSUFFICIENT_ROLE on every student verb.
func TestStudentHandler_StudentCaller403_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	caller := stuMember(t, db, centerA.ID, "stu-caller@example.com", "student")
	srv := test.NewStudentTestServerForRole(t, db, caller, test.TenantAID, "student")

	sid := uuid.NewString()
	nid := uuid.NewString()
	cases := []struct {
		method, path, body string
	}{
		{http.MethodGet, "/api/students", ""},
		{http.MethodGet, "/api/students/" + sid, ""},
		{http.MethodGet, "/api/students/" + sid + "/notes", ""},
		{http.MethodPost, "/api/students/" + sid + "/notes", `{"content":"x"}`},
		{http.MethodPatch, "/api/students/" + sid + "/notes/" + nid, `{"flagged":true}`},
		{http.MethodDelete, "/api/students/" + sid + "/notes/" + nid, ""},
	}
	for _, c := range cases {
		req := newReqWithRequestID(c.method, c.path, c.body)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusForbidden {
			t.Fatalf("%s %s as student: want 403, got %d (body=%q)", c.method, c.path, rec.Code, rec.Body.String())
		}
		var env errorEnvelope
		_ = json.NewDecoder(rec.Body).Decode(&env)
		if env.Error.Code != "INSUFFICIENT_ROLE" {
			t.Errorf("%s %s: want INSUFFICIENT_ROLE, got %q", c.method, c.path, env.Error.Code)
		}
	}
}

// ★ AC7/D11 — a teacher out of scope gets 404 STUDENT_NOT_FOUND (never 403) on
// detail + notes; the positive control (admin) sees the same student 200.
func TestStudentHandler_TeacherOutOfScope404_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)

	t1 := stuMember(t, db, centerA.ID, "t1@example.com", "teacher")
	t2 := stuMember(t, db, centerA.ID, "t2@example.com", "teacher")
	admin := stuMember(t, db, centerA.ID, "admin@example.com", "admin")
	class2 := stuClass(t, db, centerA.ID, t2) // taught by T2 only
	s2 := stuMember(t, db, centerA.ID, "s2@example.com", "student")
	stuEnroll(t, db, centerA.ID, s2, class2)
	s2ID := test.UUIDString(s2)

	t1Srv := test.NewStudentTestServerForRole(t, db, t1, test.TenantAID, "teacher")
	for _, tc := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/students/" + s2ID, ""},
		{http.MethodGet, "/api/students/" + s2ID + "/notes", ""},
		{http.MethodPost, "/api/students/" + s2ID + "/notes", `{"content":"x"}`},
	} {
		req := newReqWithRequestID(tc.method, tc.path, tc.body)
		rec := httptest.NewRecorder()
		t1Srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusNotFound {
			t.Fatalf("%s %s as T1(out-of-scope): want 404, got %d (body=%q)", tc.method, tc.path, rec.Code, rec.Body.String())
		}
		var env errorEnvelope
		_ = json.NewDecoder(rec.Body).Decode(&env)
		if env.Error.Code != "STUDENT_NOT_FOUND" {
			t.Errorf("%s %s: want STUDENT_NOT_FOUND (no existence leak), got %q", tc.method, tc.path, env.Error.Code)
		}
	}

	// positive control — admin sees s2's detail.
	adminSrv := test.NewStudentTestServerForRole(t, db, admin, test.TenantAID, "admin")
	req := newReqWithRequestID(http.MethodGet, "/api/students/"+s2ID, "")
	rec := httptest.NewRecorder()
	adminSrv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin detail of s2: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// AC14 — the author-or-owner/admin note-delete guard. A teacher who teaches the
// student may delete their OWN note (204) but NOT another author's (403 FORBIDDEN);
// an owner may delete any (204).
func TestStudentHandler_NoteDeleteAuthz_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)

	owner := stuMember(t, db, centerA.ID, "owner@example.com", "owner")
	admin := stuMember(t, db, centerA.ID, "admin@example.com", "admin")
	teacher := stuMember(t, db, centerA.ID, "teacher@example.com", "teacher")
	class := stuClass(t, db, centerA.ID, teacher)
	student := stuMember(t, db, centerA.ID, "stu@example.com", "student")
	stuEnroll(t, db, centerA.ID, student, class)
	sID := test.UUIDString(student)

	teacherSrv := test.NewStudentTestServerForRole(t, db, teacher, test.TenantAID, "teacher")
	ownerSrv := test.NewStudentTestServerForRole(t, db, owner, test.TenantAID, "owner")

	// (a) teacher deletes ANOTHER author's (admin's) note → 403 FORBIDDEN.
	adminNote := stuNote(t, db, centerA.ID, student, admin)
	req := newReqWithRequestID(http.MethodDelete, "/api/students/"+sID+"/notes/"+adminNote.String(), "")
	rec := httptest.NewRecorder()
	teacherSrv.ServeHTTP(rec, req)
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher delete admin's note: want 403, got %d (body=%q)", rec.Code, rec.Body.String())
	}

	// (b) teacher deletes their OWN note → 204.
	ownNote := stuNote(t, db, centerA.ID, student, teacher)
	req = newReqWithRequestID(http.MethodDelete, "/api/students/"+sID+"/notes/"+ownNote.String(), "")
	rec = httptest.NewRecorder()
	teacherSrv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("teacher delete own note: want 204, got %d (body=%q)", rec.Code, rec.Body.String())
	}

	// (c) owner deletes admin's note → 204 (owner may delete any).
	req = newReqWithRequestID(http.MethodDelete, "/api/students/"+sID+"/notes/"+adminNote.String(), "")
	rec = httptest.NewRecorder()
	ownerSrv.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("owner delete admin's note: want 204, got %d (body=%q)", rec.Code, rec.Body.String())
	}
}

// AC12 — empty content → 422 VALIDATION_ERROR.
func TestStudentHandler_CreateNoteEmptyContent422_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := stuMember(t, db, centerA.ID, "owner@example.com", "owner")
	student := stuMember(t, db, centerA.ID, "stu@example.com", "student")
	srv := test.NewStudentTestServerForRole(t, db, owner, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodPost, "/api/students/"+test.UUIDString(student)+"/notes", `{"content":""}`)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("empty content: want 422, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "VALIDATION_ERROR") {
		t.Errorf("body should mention VALIDATION_ERROR, got %q", rec.Body.String())
	}
}

// AC1/AC5 — owner GET /api/students → 200 with the paginated envelope; the seeded
// student appears and meta.pagination is present.
func TestStudentHandler_ListHappy200Paginated_ATDD(t *testing.T) {
	db := test.SetupDB(t)
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Center A", "center-a")
	test.TenantContext(t, db, centerA.ID)
	owner := stuMember(t, db, centerA.ID, "owner@example.com", "owner")
	student := stuMember(t, db, centerA.ID, "stu@example.com", "student")
	srv := test.NewStudentTestServerForRole(t, db, owner, test.TenantAID, "owner")

	req := newReqWithRequestID(http.MethodGet, "/api/students?page=1&page_size=20", "")
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("owner list: want 200, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	body := rec.Body.String()
	if !strings.Contains(body, "pagination") {
		t.Errorf("want meta.pagination in envelope, got %q", body)
	}
	if !strings.Contains(body, test.UUIDString(student)) {
		t.Errorf("want the seeded student %s in the roster, got %q", test.UUIDString(student), body)
	}
}
