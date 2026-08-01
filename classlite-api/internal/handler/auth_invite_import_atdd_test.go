// Story 2.7 Task 6a — accept-invite must let a PRE-PROVISIONED student (created
// by the bulk import with NULL password_hash AND NULL google_id) set a password
// on accept, WITHOUT regressing the genuine-OAuth guard. Shared-surface auth
// change — the OAuth rejection must be re-keyed on google_id presence, not on
// password-hash absence (auth_invite.go:88).
//
// Compiled only under `-tags atdd_red_phase`. Reuses the Story 1.6 accept-invite
// harness (newAcceptInviteHarness / seedInviteForHandler / hashInviteTokenForHandlerTest
// / newReqWithRequestID) — no re-declaration.
//
// CASES
//
//	(a) NULL pw + NULL google_id + password  → success (account claim). Currently
//	    409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER — THIS is the bug Task 6a fixes.
//	(b) NULL pw + google_id SET + password    → still 409 (no OAuth regression).
//	(c) existing password user                → unaffected (success).
package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedImportInviteFor wires an owner + center + a `student` invite to the given
// email, returning the raw invite token to POST. Mirrors the happy-path setup
// in accept_invite_handler_atdd_test.go.
func seedImportInviteFor(t *testing.T, db *test.TxDB, mockClock *clock.MockClock, email string) string {
	t.Helper()
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner-import-"+uuid.NewString()[:8]+"@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "import-accept-" + uuid.NewString()
	seedInviteForHandler(t, db,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		email, "student",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(7*24*time.Hour),
	)
	return rawToken
}

func postAcceptInvite(t *testing.T, h interface {
	AcceptInvite(http.ResponseWriter, *http.Request) error
}, rawToken, fullName, password string) *httptest.ResponseRecorder {
	t.Helper()
	body := `{"inviteToken":"` + rawToken + `","fullName":"` + fullName + `","password":"` + password + `"}`
	req := newReqWithRequestID(http.MethodPost, "/api/auth/accept-invite", body)
	rec := httptest.NewRecorder()
	middleware.ErrorMapper(h.AcceptInvite).ServeHTTP(rec, req)
	return rec
}

// (a) Pre-provisioned import student: NULL password_hash, NULL google_id. Setting
// a password on accept must SUCCEED — this is a pending-invite account, not an
// OAuth account. (Story text says "201"; the accept endpoint's success code is
// 200 per AC-1.6-04 — asserting the real success contract. Dev/QA reconcile the
// wording, but the load-bearing check is: NOT 409, and an accessToken is minted.)
func TestAcceptInvite_Import_PreProvisionedStudentSetsPassword_Success(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	email := "imported-student-" + uuid.NewString()[:8] + "@example.com"
	// Pre-provision exactly as the import does: user row, NULL pw, NULL google_id.
	student := test.CreateUser(t, db, email, "Imported Student")
	assertNullAuthColumns(t, db, student.ID)

	rawToken := seedImportInviteFor(t, db, mockClock, email)
	rec := postAcceptInvite(t, h, rawToken, "Imported Student", "StudentPass123!")

	if rec.Code == http.StatusConflict {
		t.Fatalf("pre-provisioned student accept → 409 (PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER); "+
			"Task 6a must key the OAuth guard on google_id, not password-hash absence (body: %s)", rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("pre-provisioned student accept → %d, want 200 (body: %s)", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			AccessToken string `json:"accessToken"`
		} `json:"data"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode envelope: %v", err)
	}
	if env.Data.AccessToken == "" {
		t.Error("accessToken empty — account claim did not complete")
	}
}

// (b) Genuine OAuth user: NULL password_hash but google_id SET. A submitted
// password must STILL be rejected 409 — the guard must not regress.
func TestAcceptInvite_Import_GenuineOAuthUserPassword_Still409(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	email := "oauth-user-" + uuid.NewString()[:8] + "@example.com"
	oauthUser := test.CreateUser(t, db, email, "OAuth User")
	// Make it genuinely OAuth: google_id set, password_hash still NULL.
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET google_id = $1 WHERE id = $2`,
		"google-oauth-"+uuid.NewString()[:8], oauthUser.ID); err != nil {
		t.Fatalf("set google_id: %v", err)
	}

	rawToken := seedImportInviteFor(t, db, mockClock, email)
	rec := postAcceptInvite(t, h, rawToken, "OAuth User", "TryToSetPass123!")

	if rec.Code != http.StatusConflict {
		t.Fatalf("genuine-OAuth user + password → %d, want 409 (no regression) (body: %s)", rec.Code, rec.Body.String())
	}
	if code := errCodeOf(t, rec.Body.Bytes()); code != "PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER" {
		t.Errorf("error code = %q, want PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER", code)
	}
}

// (c) Existing password user: accepting an invite is unaffected by Task 6a.
func TestAcceptInvite_Import_ExistingPasswordUser_Unaffected(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 24, 12, 0, 0, 0, time.UTC))
	h, db := newAcceptInviteHarness(t, mockClock)

	email := "existing-pw-" + uuid.NewString()[:8] + "@example.com"
	pwUser := test.CreateUser(t, db, email, "Existing PW User")
	if _, err := db.Exec(context.Background(),
		`UPDATE users SET password_hash = $1 WHERE id = $2`,
		"$2a$04$abcdefghijklmnopqrstuvwxyABCDEFGHIJKLMNOPQRSTUV0123456", pwUser.ID); err != nil {
		t.Fatalf("set password_hash: %v", err)
	}

	rawToken := seedImportInviteFor(t, db, mockClock, email)
	rec := postAcceptInvite(t, h, rawToken, "Existing PW User", "AnotherPass123!")

	if rec.Code != http.StatusOK {
		t.Fatalf("existing-password user accept → %d, want 200 (unaffected by Task 6a) (body: %s)", rec.Code, rec.Body.String())
	}
}

// assertNullAuthColumns is a setup sanity check: the pre-provisioned student
// must have BOTH password_hash and google_id NULL (the invite-claim signal).
func assertNullAuthColumns(t *testing.T, db *test.TxDB, userID pgtype.UUID) {
	t.Helper()
	var pwNull, googleNull bool
	if err := db.QueryRow(context.Background(),
		`SELECT password_hash IS NULL, google_id IS NULL FROM users WHERE id = $1`, userID,
	).Scan(&pwNull, &googleNull); err != nil {
		t.Fatalf("read auth columns: %v", err)
	}
	if !pwNull || !googleNull {
		t.Fatalf("setup invariant: pre-provisioned student must have NULL password_hash (%v) AND NULL google_id (%v)", !pwNull, !googleNull)
	}
}
