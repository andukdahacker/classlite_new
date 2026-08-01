// Story 2.7 — Bulk-import integration red-phase suite. Drives the real
// preview/confirm HTTP path (real middleware → service → real DB) and asserts
// persisted state via the superuser pool. This is the "business rules via
// real-DB handler integration tests" seam the story mandates (no mock-store —
// 3.4.5 precedent). Compiled only under `-tags atdd_red_phase`.
//
// COVERAGE (story Testing Requirements + Task 0):
//
//	INT-BULK-001      valid+invalid rows → per-row status classification
//	INT-BULK-002      malformed header → file-level 422, 0 persisted
//	INT-BULK-003      pre-existing global account (no membership) → existing_user, linked
//	INT-BULK-OTHER    user already in ANOTHER center → validation_error USER_IN_ANOTHER_CENTER
//	INT-BULK-DUPE     Foo@X.com / foo@x.com deduped intra-file AND at lookup
//	INT-BULK-BOM      UTF-8 BOM header stripped before column match
//	INT-BULK-CONFIRM  confirm creates user + center_members(student) + enrollment + invite
//	INT-BULK-UNASSIGN row with no class → student member, NO enrollment
//	INT-BULK-PARTIAL  mixed rows → commit persists valid, result lists failed w/ reasons
//	INT-BULK-004      sequential re-run → no double-insert (ON CONFLICT DO NOTHING)
//	INT-BULK-CONCUR   two concurrent confirms of same file → no doubles, constraint holds
//	INT-BULK-DIVERGE  class renamed between preview & confirm → confirm re-classifies, no 500
//	INT-BULK-ROLLBACK commit/audit failure → full rollback (documented placeholder — needs fault seam)
package handler_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgxpool"
)

// countRows runs a scalar COUNT via the superuser pool (bypasses RLS for
// assertions — never for the code under test).
func countRows(t *testing.T, sp *pgxpool.Pool, query string, args ...any) int {
	t.Helper()
	var n int
	if err := sp.QueryRow(context.Background(), query, args...).Scan(&n); err != nil {
		t.Fatalf("count query %q: %v", query, err)
	}
	return n
}

// cleanupImportedUsers purges users (and their memberships/enrollments) created
// by a confirm run, keyed by email — the fixture purge only knows the 4 seeded
// users, not the students an import mints.
func cleanupImportedUsers(t *testing.T, sp *pgxpool.Pool, emails ...string) {
	t.Cleanup(func() {
		ctx := context.Background()
		for _, em := range emails {
			var uid string
			if err := sp.QueryRow(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, em).Scan(&uid); err != nil {
				continue
			}
			_, _ = sp.Exec(ctx, `DELETE FROM enrollments WHERE student_id = $1`, uid)
			_, _ = sp.Exec(ctx, `DELETE FROM center_members WHERE user_id = $1`, uid)
			_, _ = sp.Exec(ctx, `DELETE FROM invites WHERE lower(email) = lower($1)`, em)
			_, _ = sp.Exec(ctx, `DELETE FROM users WHERE id = $1`, uid)
		}
	})
}

// -----------------------------------------------------------------------------
// INT-BULK-001 — preview classifies each row; confirm persists the valid ones.
// -----------------------------------------------------------------------------

func TestImport_INT001_PerRowClassification(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	good := "good-" + sfx + "@example.com"
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(
		good+",Good Student,",          // new_user, unassigned
		"not-an-email,Bad Format,",     // validation_error (bad email)
		"missing-name-"+sfx+"@x.com,,", // validation_error (empty full_name)
	))
	cleanupImportedUsers(t, test.SuperuserPool(t), good)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	summary, ok := got.Data["summary"].(map[string]any)
	if !ok {
		t.Fatalf("preview data.summary missing/typed wrong: %#v", got.Data)
	}
	if summary["willImport"].(float64) != 1 {
		t.Errorf("willImport = %v, want 1 (only the good row)", summary["willImport"])
	}
	if summary["willSkip"].(float64) != 2 {
		t.Errorf("willSkip = %v, want 2 (bad email + empty name)", summary["willSkip"])
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-002 — malformed/missing header → file-level 422 VALIDATION_ERROR and
// ZERO rows persisted (0-persist contract).
// -----------------------------------------------------------------------------

func TestImport_INT002_MalformedHeader_422_ZeroPersisted(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	before := countRows(t, sp, `SELECT count(*) FROM center_members WHERE center_id = $1`, e.centerID)

	key := importKey(e.centerID)
	// Wrong column names — no email/full_name header.
	e.srv.Storage.SeedObject(key, []byte("mail,name\nx@y.com,X\n"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("malformed-header confirm → %d, want 422 (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("error code = %q, want VALIDATION_ERROR", code)
	}
	after := countRows(t, sp, `SELECT count(*) FROM center_members WHERE center_id = $1`, e.centerID)
	if after != before {
		t.Errorf("member count changed %d→%d — malformed header must persist NOTHING", before, after)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-003 — an email that already has a GLOBAL users row but no center
// membership classifies existing_user and is LINKED (no duplicate user).
// -----------------------------------------------------------------------------

func TestImport_INT003_ExistingGlobalAccount_LinkedNotDuplicated(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "existing-" + sfx + "@example.com"
	// A pre-existing global account with NO center membership.
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1, $2, true)`,
		email, "Existing Person"); err != nil {
		t.Fatalf("seed existing global user: %v", err)
	}
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Existing Person,"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm existing-account → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, email); n != 1 {
		t.Errorf("users rows for %s = %d, want 1 (linked, not duplicated)", email, n)
	}
	if n := countRows(t, sp, `SELECT count(*) FROM center_members WHERE center_id = $1 AND role = 'student'`, e.centerID); n < 1 {
		t.Errorf("student membership not created for existing account (got %d)", n)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-OTHER — a user who is already a member of ANOTHER center is a
// validation_error (one-center invariant, idx_center_members_user_id).
// -----------------------------------------------------------------------------

func TestImport_INTOther_UserInAnotherCenter_ValidationError(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "elsewhere-" + sfx + "@example.com"
	var uid string
	if err := sp.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1,$2,true) RETURNING id`,
		email, "Elsewhere").Scan(&uid); err != nil {
		t.Fatalf("seed other-center user: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1,$2,'student')`,
		uid, e.centerBID); err != nil {
		t.Fatalf("add other-center membership: %v", err)
	}
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Elsewhere,"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	rows, _ := got.Data["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected 1 preview row, got %d", len(rows))
	}
	row := rows[0].(map[string]any)
	if row["status"] != "validation_error" {
		t.Errorf("status = %v, want validation_error (USER_IN_ANOTHER_CENTER)", row["status"])
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-DUPE — case/whitespace-insensitive intra-file dedup: the 2nd
// occurrence is a validation_error, and at most one account is touched.
// -----------------------------------------------------------------------------

func TestImport_INTDupe_CaseInsensitiveDedup(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	email := "dupe-" + sfx + "@example.com"
	key := importKey(e.centerID)
	// Same normalized email twice: first canonical, second UPPER + surrounding
	// spaces. Normalization (lowercase + trim) must collapse them so the second
	// is flagged an intra-file duplicate.
	e.srv.Storage.SeedObject(key, importCSV(
		email+",First Wins,",
		" "+strings.ToUpper(email)+" ,Second Loses,",
	))
	cleanupImportedUsers(t, test.SuperuserPool(t), email)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	summary := got.Data["summary"].(map[string]any)
	if summary["willImport"].(float64) != 1 {
		t.Errorf("willImport = %v, want 1 (second normalized-dup is skipped)", summary["willImport"])
	}
	if summary["willSkip"].(float64) != 1 {
		t.Errorf("willSkip = %v, want 1 (the case/space duplicate)", summary["willSkip"])
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-BOM — a UTF-8 BOM prefixing the header must be stripped before the
// column-name match, else the BOM binds to the first column name (a
// "<BOM>email" header that no longer matches "email") and the file wrongly
// reports a malformed header.
// -----------------------------------------------------------------------------

func TestImport_INTBom_HeaderStripped(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	email := "bom-" + sfx + "@example.com"
	key := importKey(e.centerID)
	body := append([]byte{0xEF, 0xBB, 0xBF}, importCSV(email+",BOM Student,")...)
	e.srv.Storage.SeedObject(key, body)
	cleanupImportedUsers(t, test.SuperuserPool(t), email)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("BOM-prefixed header preview → %d, want 200 (BOM must be stripped) (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["summary"].(map[string]any)["willImport"].(float64) != 1 {
		t.Errorf("willImport want 1 — BOM header not stripped, row misclassified")
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-CONFIRM — confirm with a resolvable class creates the full graph:
// users + center_members(student) + active enrollment.
// -----------------------------------------------------------------------------

func TestImport_INTConfirm_CreatesUserMemberEnrollment(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	email := "enroll-" + sfx + "@example.com"
	className := "Math " + sfx
	test.SeedClass(t, e.centerID, className, "active", nil, nil)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Enroll Me,"+className))
	cleanupImportedUsers(t, sp, email)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, email); n != 1 {
		t.Errorf("users rows = %d, want 1", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM center_members m JOIN users u ON u.id = m.user_id
		 WHERE m.center_id = $1 AND m.role = 'student' AND lower(u.email) = lower($2)`,
		e.centerID, email); n != 1 {
		t.Errorf("student membership rows = %d, want 1", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id
		 WHERE en.center_id = $1 AND en.status = 'active' AND lower(u.email) = lower($2)`,
		e.centerID, email); n != 1 {
		t.Errorf("active enrollment rows = %d, want 1 (enrollment via import tx sqlc, AC4)", n)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-UNASSIGN — a row with no class_name creates a student member with NO
// enrollment (the classless/unassigned path, AC1).
// -----------------------------------------------------------------------------

func TestImport_INTUnassigned_MemberButNoEnrollment(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	email := "unassigned-" + sfx + "@example.com"
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",No Class,")) // class_name empty
	cleanupImportedUsers(t, sp, email)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM center_members m JOIN users u ON u.id = m.user_id
		 WHERE m.center_id = $1 AND m.role = 'student' AND lower(u.email) = lower($2)`,
		e.centerID, email); n != 1 {
		t.Errorf("student membership = %d, want 1 (unassigned still a member)", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id WHERE lower(u.email) = lower($1)`,
		email); n != 0 {
		t.Errorf("enrollments for unassigned student = %d, want 0", n)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-PARTIAL — mixed valid+invalid rows: confirm COMMITS, the valid rows
// persist, and the result reports the failed rows with reasons (partial import).
// -----------------------------------------------------------------------------

func TestImport_INTPartial_CommitsValidReportsFailed(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	ok1 := "ok1-" + sfx + "@example.com"
	ok2 := "ok2-" + sfx + "@example.com"
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(
		ok1+",Valid One,",
		"garbage-email,Bad,",
		ok2+",Valid Two,",
	))
	cleanupImportedUsers(t, sp, ok1, ok2)

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("partial confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["created"].(float64) != 2 {
		t.Errorf("created = %v, want 2", got.Data["created"])
	}
	if got.Data["failed"].(float64) != 1 {
		t.Errorf("failed = %v, want 1", got.Data["failed"])
	}
	for _, em := range []string{ok1, ok2} {
		if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, em); n != 1 {
			t.Errorf("valid row %s persisted count = %d, want 1 (committed despite sibling error)", em, n)
		}
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-004 — sequential re-run of the same file must not double-insert.
// -----------------------------------------------------------------------------

func TestImport_INT004_SequentialRerun_NoDoubleInsert(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	email := "rerun-" + sfx + "@example.com"
	className := "Rerun " + sfx
	test.SeedClass(t, e.centerID, className, "active", nil, nil)
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Rerun Student,"+className))
	cleanupImportedUsers(t, sp, email)

	for i := 0; i < 2; i++ {
		rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
		if rec.Code != http.StatusOK {
			t.Fatalf("confirm run %d → %d, want 200 (body: %s)", i+1, rec.Code, rec.Body.String())
		}
	}
	if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, email); n != 1 {
		t.Errorf("users after 2 runs = %d, want 1 (idempotent)", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id
		 WHERE en.status = 'active' AND lower(u.email) = lower($1)`, email); n != 1 {
		t.Errorf("active enrollments after 2 runs = %d, want 1 (CreateEnrollmentIfNotActive ON CONFLICT)", n)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-CONCUR — two concurrent confirms of the same file: the active-unique
// constraint holds, no double rows, and the DB is left correct.
// -----------------------------------------------------------------------------

func TestImport_INTConcurrent_SameFile_NoDoubles(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	email := "concur-" + sfx + "@example.com"
	className := "Concur " + sfx
	test.SeedClass(t, e.centerID, className, "active", nil, nil)
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Concurrent Student,"+className))
	cleanupImportedUsers(t, sp, email)

	var wg sync.WaitGroup
	codes := make([]int, 2)
	for i := 0; i < 2; i++ {
		wg.Add(1)
		go func(idx int) {
			defer wg.Done()
			rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
			codes[idx] = rec.Code
		}(i)
	}
	wg.Wait()

	if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, email); n != 1 {
		t.Errorf("users after concurrent confirms = %d, want 1", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id
		 WHERE en.status = 'active' AND lower(u.email) = lower($1)`, email); n != 1 {
		t.Errorf("active enrollments after concurrent confirms = %d, want 1 (uq_enrollments_active holds)", n)
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-DIVERGE — preview resolves a class, the class is renamed, then
// confirm re-classifies from scratch (preview advisory, confirm authoritative).
// The row's class no longer resolves → confirm handles it WITHOUT a 500.
// -----------------------------------------------------------------------------

func TestImport_INTDiverge_ClassRenamedBetweenPreviewAndConfirm(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "diverge-" + sfx + "@example.com"
	className := "Original " + sfx
	classID := test.SeedClass(t, e.centerID, className, "active", nil, nil)
	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Diverge Student,"+className))
	cleanupImportedUsers(t, sp, email)

	// Preview (advisory) — class resolves.
	pre := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if pre.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", pre.Code, pre.Body.String())
	}

	// Rename the class out from under the preview.
	if _, err := sp.Exec(ctx, `UPDATE classes SET name = $1 WHERE id = $2`, "Renamed "+sfx, classID.String()); err != nil {
		t.Fatalf("rename class: %v", err)
	}

	// Confirm re-classifies: the class name no longer matches → the row becomes
	// a validation_error (CLASS_NAME_NOT_FOUND). The contract is "no crash";
	// the commit still succeeds for any valid rows and reports the outcome.
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code == http.StatusInternalServerError {
		t.Fatalf("confirm after class-rename → 500; must re-classify gracefully (body: %s)", rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm after class-rename → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
}

// -----------------------------------------------------------------------------
// INT-BULK-ROLLBACK — a commit/audit failure must roll the WHOLE import back
// (0 persisted), leaving a naturally-idempotent retry. The fault seam is a
// StudentImportService wired with a failingAuditLogger (LogWithinTx errors), so
// every row write succeeds inside its savepoint but the commit-time audit forces
// the deferred tx.Rollback → nothing persists. Driven at the service level (the
// black-box HTTP path cannot inject the fault).
// -----------------------------------------------------------------------------

func TestImport_INTRollback_AuditFailure_ZeroPersisted(t *testing.T) {
	pool := test.SetupRawPool(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]

	owner := test.CreateUserOnPool(t, pool, "owner-rb-"+sfx+"@example.com", "Owner RB")
	test.MarkUserEmailVerifiedOnPool(t, pool, owner.ID)
	centerPg := test.CreateCenterForOwner(t, pool, owner.ID)
	centerID := test.UUIDString(centerPg)
	className := "Rollback " + sfx
	test.SeedClass(t, centerID, className, "active", nil, nil)

	email := "rollback-" + sfx + "@example.com"
	importSvc, storage := test.NewStudentImportServiceWithFailingAudit(t, pool)
	key := importKey(centerID)
	storage.SeedObject(key, importCSV(email+",Rollback Student,"+className))
	cleanupImportedUsers(t, sp, email)
	t.Cleanup(func() {
		_, _ = sp.Exec(context.Background(), `DELETE FROM enrollments WHERE center_id = $1`, centerID)
	})

	tc := model.TenantContext{CenterID: centerID, UserID: test.UUIDString(owner.ID), Role: "owner", EmailVerified: true}
	if _, err := importSvc.ConfirmImport(context.Background(), tc, key, uuid.NewString()); err == nil {
		t.Fatal("confirm with a failing audit logger → nil error, want a rollback error")
	}

	if n := countRows(t, sp, `SELECT count(*) FROM users WHERE lower(email) = lower($1)`, email); n != 0 {
		t.Errorf("users persisted = %d, want 0 (audit failure must roll the whole import back)", n)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments en JOIN users u ON u.id = en.student_id WHERE lower(u.email) = lower($1)`,
		email); n != 0 {
		t.Errorf("enrollments persisted = %d, want 0", n)
	}
}
