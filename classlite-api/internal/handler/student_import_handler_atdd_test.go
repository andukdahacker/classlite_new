// Story 2.7 — StudentImportHandler ATDD red-phase suite (TEST-BE-3: real
// middleware, real service, real DB via the committed raw pool). Compiled only
// under `-tags atdd_red_phase`; see internal/test/story_2_7_helpers.go for the
// red-phase mechanics and dev-reconcile points.
//
// ACCEPTANCE CRITERIA / RISK COVERED
//
//	AC1/AC6  owner/admin reach the import endpoints; row-limit rejection.
//	R15      role re-validated from center_members (SEC-1): teacher/student →
//	         403 INSUFFICIENT_ROLE, and a STALE/ELEVATED owner-JWT handed to a
//	         DB-teacher still 403 (the deciding-factor test, EDGE-2).
//	R1 (file-read leak)  a cross-tenant object key (centerB/… passed by centerA)
//	         → 403 FORBIDDEN. GetObject bypasses RLS, so this needs its own
//	         negative — the write-isolation test alone would NOT catch it
//	         (story Blocker #4).
//	Envelope  full {data,meta} on success, {error:{code,message,requestId}} on
//	         failure (GFW-5); missing key → 404 IMPORT_FILE_NOT_FOUND.
//
// Reuses the handler_test shared helpers classReq / errCodeOf / decodeClassEnvelope
// (class_handler_atdd_test.go, session_handler_atdd_test.go) — no re-declaration.
package handler_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// -----------------------------------------------------------------------------
// Fixtures
// -----------------------------------------------------------------------------

type importHandlerEnv struct {
	srv        test.StudentImportTestServer
	centerID   string
	centerBID  string
	validKey   string      // seeded 2-row CSV under centerA
	crossKey   string      // seeded CSV under centerB (for the cross-tenant-key 403)
	teacherID  pgtype.UUID // for the stale-owner-JWT-for-teacher R15 case
	ownerTok   string
	adminTok   string
	teacherTok string
	studentTok string
}

// importCSV builds a deterministic CSV body: header + one line per row.
func importCSV(rows ...string) []byte {
	var b strings.Builder
	b.WriteString("email,full_name,class_name\n")
	for _, r := range rows {
		b.WriteString(r)
		b.WriteString("\n")
	}
	return []byte(b.String())
}

func importKey(centerID string) string {
	return fmt.Sprintf("%s/imports/%s.csv", centerID, uuid.NewString())
}

func setupImportHandlerTest(t *testing.T) importHandlerEnv {
	t.Helper()
	pool := test.SetupRawPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-"+sfx+"@example.com", "Owner")
	admin := test.CreateUserOnPool(t, pool, "admin-"+sfx+"@example.com", "Admin")
	teacher := test.CreateUserOnPool(t, pool, "teacher-"+sfx+"@example.com", "Teacher")
	student := test.CreateUserOnPool(t, pool, "student-"+sfx+"@example.com", "Student")
	for _, u := range []test.User{owner, admin, teacher, student} {
		test.MarkUserEmailVerifiedOnPool(t, pool, u.ID)
	}

	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	test.AddCenterMember(t, pool, centerPg, admin.ID, "admin")
	test.AddCenterMember(t, pool, centerPg, teacher.ID, "teacher")
	test.AddCenterMember(t, pool, centerPg, student.ID, "student")

	// A second center B — only its object-key prefix matters (cross-tenant-key
	// negative). Created via the superuser pool to avoid exhausting the
	// per-user advisory-lock connections CreateUserOnPool holds.
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	var centerBID string
	if err := sp.QueryRow(ctx,
		`INSERT INTO centers (name, short_code) VALUES ($1, $2) RETURNING id`,
		"Center B "+sfx, "cb-"+sfx).Scan(&centerBID); err != nil {
		t.Fatalf("insert center B: %v", err)
	}
	t.Cleanup(func() {
		_, _ = sp.Exec(ctx, `DELETE FROM centers WHERE id = $1`, centerBID)
		// Confirm-path residue (any test that persisted) under center A.
		_, _ = sp.Exec(ctx, `DELETE FROM audit_logs WHERE entity_type = 'center' AND entity_id = $1`, centerID)
		_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE center_id = $1`, centerPg)
	})

	srv := test.NewStudentImportTestServerBareMux(t, pool)

	validKey := importKey(centerID)
	srv.Storage.SeedObject(validKey, importCSV(
		"alice-"+sfx+"@example.com,Alice Anderson,",
		"bob-"+sfx+"@example.com,Bob Brown,",
	))
	crossKey := importKey(centerBID)
	srv.Storage.SeedObject(crossKey, importCSV("mallory-"+sfx+"@example.com,Mallory,"))

	return importHandlerEnv{
		srv:        srv,
		centerID:   centerID,
		centerBID:  centerBID,
		validKey:   validKey,
		crossKey:   crossKey,
		teacherID:  teacher.ID,
		ownerTok:   test.SignAccessTokenForRole(t, owner.ID, centerID, "owner"),
		adminTok:   test.SignAccessTokenForRole(t, admin.ID, centerID, "admin"),
		teacherTok: test.SignAccessTokenForRole(t, teacher.ID, centerID, "teacher"),
		studentTok: test.SignAccessTokenForRole(t, student.ID, centerID, "student"),
	}
}

func previewBody(key string) map[string]any { return map[string]any{"key": key} }

func confirmBody(key string) map[string]any {
	return map[string]any{"key": key, "importId": uuid.NewString()}
}

// -----------------------------------------------------------------------------
// AC1 — owner/admin reach preview → 200 with the {data,meta} envelope.
// -----------------------------------------------------------------------------

func TestImport_Preview_Owner_200Envelope(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(e.validKey))
	if rec.Code != http.StatusOK {
		t.Fatalf("owner preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["summary"] == nil {
		t.Errorf("preview envelope missing data.summary (want {total,willImport,willSkip,unassigned})")
	}
	if got.Meta.ServerTime == "" {
		t.Error("preview envelope missing meta.serverTime")
	}
}

func TestImport_Preview_Admin_200(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.adminTok, previewBody(e.validKey))
	if rec.Code != http.StatusOK {
		t.Fatalf("admin preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// -----------------------------------------------------------------------------
// R15 (SEC-1) — role re-validated from center_members. Teacher/Student whose JWT
// role matches their DB role are blocked; the stale-owner-JWT-for-teacher proves
// the DB read (not the JWT claim) is the deciding factor.
// -----------------------------------------------------------------------------

func TestImport_Preview_TeacherForbidden_403(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.teacherTok, previewBody(e.validKey))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("teacher preview → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

func TestImport_Preview_StudentForbidden_403(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.studentTok, previewBody(e.validKey))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("student preview → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE", code)
	}
}

// R15 deciding-factor: an owner-role JWT minted for a user who is a `teacher` in
// center_members. If confirm trusted the JWT claim this would pass; the DB role
// re-validation (service tx, story Task 5) must still 403. Uses confirm because
// that is where the story pins the DB re-check.
func TestImport_Confirm_StaleOwnerJWTForTeacher_403(t *testing.T) {
	e := setupImportHandlerTest(t)
	forged := test.SignAccessTokenForRole(t, e.teacherID, e.centerID, "owner")
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", forged, confirmBody(e.validKey))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("owner-claim JWT for a DB teacher → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE (role re-validated from center_members, not the JWT)", code)
	}
}

// -----------------------------------------------------------------------------
// R1 (file-read leak) — a cross-tenant object key is rejected 403 FORBIDDEN
// BEFORE any parse. centerA's owner passes centerB's key.
// -----------------------------------------------------------------------------

func TestImport_Preview_CrossTenantKey_403(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(e.crossKey))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("cross-tenant key preview → %d, want 403 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "FORBIDDEN" {
		t.Errorf("error code = %q, want FORBIDDEN (tenant-key HasPrefix guard, story Blocker #4)", code)
	}
}

// -----------------------------------------------------------------------------
// AC6 — >200 data rows → 422 IMPORT_ROW_LIMIT_EXCEEDED. Boundary: 200 ok / 201
// reject / header excluded.
// -----------------------------------------------------------------------------

func TestImport_Preview_RowLimit_200RowsOK(t *testing.T) {
	e := setupImportHandlerTest(t)
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(nRows(t, 200)...))
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("200-row preview → %d, want 200 (exactly-200 passes, header excluded) (body: %s)", rec.Code, rec.Body.String())
	}
}

func TestImport_Preview_RowLimit_201RowsRejected_422(t *testing.T) {
	e := setupImportHandlerTest(t)
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(nRows(t, 201)...))
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("201-row preview → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "IMPORT_ROW_LIMIT_EXCEEDED" {
		t.Errorf("error code = %q, want IMPORT_ROW_LIMIT_EXCEEDED", code)
	}
}

// nRows builds n distinct valid data rows.
func nRows(t *testing.T, n int) []string {
	t.Helper()
	rows := make([]string, 0, n)
	for i := 0; i < n; i++ {
		rows = append(rows, fmt.Sprintf("row%d-%s@example.com,Row %d,", i, uuid.NewString()[:8], i))
	}
	return rows
}

// -----------------------------------------------------------------------------
// Envelope negatives — missing key → 404 IMPORT_FILE_NOT_FOUND with the full
// {error:{code,message,requestId}} shape; unauthenticated → 401.
// -----------------------------------------------------------------------------

func TestImport_Preview_MissingKey_404ErrorEnvelope(t *testing.T) {
	e := setupImportHandlerTest(t)
	key := importKey(e.centerID) // never seeded
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusNotFound {
		t.Fatalf("missing-key preview → %d, want 404 (body: %s)", rec.Code, rec.Body.String())
	}
	assertErrorEnvelopeShape(t, rec)
	if code := errCodeOf(t, rec.Body.Bytes()); code != "IMPORT_FILE_NOT_FOUND" {
		t.Errorf("error code = %q, want IMPORT_FILE_NOT_FOUND", code)
	}
}

func TestImport_Preview_Unauthenticated_401(t *testing.T) {
	e := setupImportHandlerTest(t)
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", "", previewBody(e.validKey))
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("no token → %d, want 401 (body: %s)", rec.Code, rec.Body.String())
	}
}

// assertErrorEnvelopeShape verifies {error:{code,message,requestId}} (GFW-5/CQ-5).
func assertErrorEnvelopeShape(t *testing.T, rec *httptest.ResponseRecorder) {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error envelope: %v (body: %s)", err, rec.Body.String())
	}
	errObj, ok := body["error"].(map[string]any)
	if !ok {
		t.Fatalf("response missing error object (body: %s)", rec.Body.String())
	}
	for _, k := range []string{"code", "message", "requestId"} {
		if _, present := errObj[k]; !present {
			t.Errorf("error object missing %q key (GFW-5 envelope contract)", k)
		}
	}
}
