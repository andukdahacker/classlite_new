// Story 2.7 — Round-2 /bmad-code-review regression locks (2026-07-25).
//
// Each test pins a behavioral fix applied during the backend code-review pass so
// the bug cannot silently return. They reuse the setupImportHandlerTest harness +
// shared handler_test helpers (importCSV / classReq / decodeClassEnvelope /
// countRows / cleanupImportedUsers / errCodeOf).
//
//	D1  an existing NON-student member is skipped (USER_ALREADY_STAFF), never
//	    demoted to student by the confirm upsert.
//	D2  class_name resolves ONLY enrollable (upcoming/active) classes — an ended
//	    class is not found, and an ended+active same-name pair is not ambiguous.
//	D4  an existing account that never accepted its invite is re-invited on
//	    re-import.
//	P2  preview re-validates the caller role from center_members (stale owner-JWT
//	    for a DB teacher → 403).
//	P3  fully-blank data rows are skipped (no budget, no spurious skips).
//	P4  an earlier invalid row does not claim the dedup slot for a later valid row.
//	P6  a missing/invalid importId is rejected 422.
//	P7  invitesSent is vacuously true when there are no new invites to send.
package handler_test

import (
	"context"
	"net/http"
	"testing"

	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// D1 — an email that is already a NON-student member of the caller's center is
// flagged USER_ALREADY_STAFF and skipped; confirm must NOT demote the member.
func TestImport_ReviewD1_ExistingStaffNotDemoted(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "staffdupe-" + sfx + "@example.com"

	var uid string
	if err := sp.QueryRow(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1,$2,true) RETURNING id`,
		email, "Existing Teacher").Scan(&uid); err != nil {
		t.Fatalf("seed staff user: %v", err)
	}
	if _, err := sp.Exec(ctx,
		`INSERT INTO center_members (user_id, center_id, role) VALUES ($1,$2,'teacher')`,
		uid, e.centerID); err != nil {
		t.Fatalf("add teacher membership: %v", err)
	}
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Existing Teacher,"))

	prev := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if prev.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", prev.Code, prev.Body.String())
	}
	row := decodeClassEnvelope(t, prev).Data["rows"].([]any)[0].(map[string]any)
	if row["status"] != "validation_error" || row["error"] != "USER_ALREADY_STAFF" {
		t.Errorf("status/error = %v/%v, want validation_error/USER_ALREADY_STAFF", row["status"], row["error"])
	}

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var role string
	if err := sp.QueryRow(ctx,
		`SELECT role FROM center_members WHERE user_id=$1 AND center_id=$2`, uid, e.centerID).Scan(&role); err != nil {
		t.Fatalf("read role after confirm: %v", err)
	}
	if role != "teacher" {
		t.Errorf("role = %q, want teacher — import must NOT demote an existing staff member to student (D1)", role)
	}
}

// D2 — an ended class is not enrollable, so its name does not resolve.
func TestImport_ReviewD2_EndedClassNotEnrollable(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	email := "ended-" + sfx + "@example.com"
	className := "Dead " + sfx
	test.SeedClass(t, e.centerID, className, "ended", nil, nil)
	cleanupImportedUsers(t, test.SuperuserPool(t), email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Ended Class Student,"+className))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	row := decodeClassEnvelope(t, rec).Data["rows"].([]any)[0].(map[string]any)
	if row["status"] != "validation_error" || row["error"] != "CLASS_NAME_NOT_FOUND" {
		t.Errorf("status/error = %v/%v, want validation_error/CLASS_NAME_NOT_FOUND (ended class not enrollable, D2)", row["status"], row["error"])
	}
}

// D2 — an ended + active class sharing a name is NOT ambiguous: the row resolves
// to the active twin and enrolls there.
func TestImport_ReviewD2_SameNameEndedPlusActive_ResolvesActive(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	sfx := uuid.NewString()[:8]
	email := "collide-" + sfx + "@example.com"
	className := "Twin " + sfx
	test.SeedClass(t, e.centerID, className, "ended", nil, nil)
	activeID := test.SeedClass(t, e.centerID, className, "active", nil, nil)
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Twin Student,"+className))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if got := decodeClassEnvelope(t, rec).Data["created"].(float64); got != 1 {
		t.Errorf("created = %v, want 1 — same-name ended+active must not be CLASS_NAME_AMBIGUOUS (D2)", got)
	}
	if n := countRows(t, sp,
		`SELECT count(*) FROM enrollments WHERE class_id=$1 AND status='active'`, activeID.String()); n != 1 {
		t.Errorf("enrollment into the active twin = %d, want 1", n)
	}
}

// D4 — an existing account that never accepted its invite (no password, no
// google_id) is re-invited on re-import.
func TestImport_ReviewD4_NeverAcceptedExistingUser_ReInvited(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "neveraccepted-" + sfx + "@example.com"

	if _, err := sp.Exec(ctx,
		`INSERT INTO users (email, full_name, email_verified) VALUES ($1,$2,false)`,
		email, "Never Accepted"); err != nil {
		t.Fatalf("seed never-accepted user: %v", err)
	}
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Never Accepted,"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	if n := countRows(t, sp, `SELECT count(*) FROM invites WHERE lower(email)=lower($1)`, email); n != 1 {
		t.Errorf("invites for never-accepted re-import = %d, want 1 (D4 re-invite)", n)
	}
}

// P2 — preview re-validates the caller role from center_members, not the JWT.
func TestImport_ReviewP2_Preview_StaleOwnerJWTForTeacher_403(t *testing.T) {
	e := setupImportHandlerTest(t)
	forged := test.SignAccessTokenForRole(t, e.teacherID, e.centerID, "owner")
	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", forged, previewBody(e.validKey))
	if rec.Code != http.StatusForbidden {
		t.Fatalf("preview owner-claim JWT for DB teacher → %d, want 403 (P2, body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "INSUFFICIENT_ROLE" {
		t.Errorf("error code = %q, want INSUFFICIENT_ROLE (preview must re-validate role from center_members)", code)
	}
}

// P3 — fully-blank data rows are skipped: they neither consume the budget nor
// surface as spurious INVALID_EMAIL skips.
func TestImport_ReviewP3_BlankRowsSkipped(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	good := "p3good-" + sfx + "@example.com"
	cleanupImportedUsers(t, test.SuperuserPool(t), good)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(
		good+",Good One,",
		",,",
		",,",
	))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	s := decodeClassEnvelope(t, rec).Data["summary"].(map[string]any)
	if s["total"].(float64) != 1 {
		t.Errorf("total = %v, want 1 (blank rows excluded from the count, P3)", s["total"])
	}
	if s["willSkip"].(float64) != 0 {
		t.Errorf("willSkip = %v, want 0 (blank rows are not INVALID_EMAIL skips, P3)", s["willSkip"])
	}
}

// P4 — an earlier invalid row must not claim the dedup slot and force a later
// VALID row with the same email to be skipped as DUPLICATE_EMAIL.
func TestImport_ReviewP4_InvalidRowDoesNotClaimDedupSlot(t *testing.T) {
	e := setupImportHandlerTest(t)
	sfx := uuid.NewString()[:8]
	email := "p4-" + sfx + "@example.com"
	cleanupImportedUsers(t, test.SuperuserPool(t), email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(
		email+",,",            // invalid: MISSING_NAME
		email+",Valid Later,", // valid: must NOT be flagged DUPLICATE_EMAIL
	))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import/preview", e.ownerTok, previewBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("preview → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if s := got.Data["summary"].(map[string]any); s["willImport"].(float64) != 1 {
		t.Errorf("willImport = %v, want 1 — the valid row must import despite an earlier invalid same-email row (P4)", s["willImport"])
	}
	r2 := got.Data["rows"].([]any)[1].(map[string]any)
	if r2["error"] == "DUPLICATE_EMAIL" {
		t.Errorf("row2 flagged DUPLICATE_EMAIL — an invalid row1 wrongly claimed the dedup slot (P4)")
	}
}

// P6 — importId is required + must be a UUID.
func TestImport_ReviewP6_ImportIdValidated_422(t *testing.T) {
	e := setupImportHandlerTest(t)

	missing := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, map[string]any{"key": e.validKey})
	if missing.Code != http.StatusUnprocessableEntity {
		t.Fatalf("confirm without importId → %d, want 422 (body: %s)", missing.Code, missing.Body.String())
	}
	if code := errCodeOf(t, missing.Body.Bytes()); code != "VALIDATION_ERROR" {
		t.Errorf("missing importId error code = %q, want VALIDATION_ERROR", code)
	}

	bad := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, map[string]any{"key": e.validKey, "importId": "not-a-uuid"})
	if bad.Code != http.StatusUnprocessableEntity {
		t.Fatalf("confirm with non-UUID importId → %d, want 422 (body: %s)", bad.Code, bad.Body.String())
	}
}

// P7 — invitesSent is vacuously true when the import created no new invites
// (all rows are existing, already-accepted accounts).
func TestImport_ReviewP7_InvitesSentTrueWhenNoNewInvites(t *testing.T) {
	e := setupImportHandlerTest(t)
	sp := test.SuperuserPool(t)
	ctx := context.Background()
	sfx := uuid.NewString()[:8]
	email := "accepted-" + sfx + "@example.com"

	// Existing account that HAS accepted (password set) → no invite needed.
	if _, err := sp.Exec(ctx,
		`INSERT INTO users (email, full_name, email_verified, password_hash) VALUES ($1,$2,true,'x')`,
		email, "Accepted Student"); err != nil {
		t.Fatalf("seed accepted user: %v", err)
	}
	cleanupImportedUsers(t, sp, email)

	key := importKey(e.centerID)
	e.srv.Storage.SeedObject(key, importCSV(email+",Accepted Student,"))

	rec := classReq(t, e.srv.Mux, http.MethodPost, "/api/students/import", e.ownerTok, confirmBody(key))
	if rec.Code != http.StatusOK {
		t.Fatalf("confirm → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	got := decodeClassEnvelope(t, rec)
	if got.Data["created"].(float64) != 1 {
		t.Errorf("created = %v, want 1", got.Data["created"])
	}
	if got.Data["invitesSent"] != true {
		t.Errorf("invitesSent = %v, want true — no new invites is vacuously all-sent (P7)", got.Data["invitesSent"])
	}
}
