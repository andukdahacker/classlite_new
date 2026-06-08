// google_oauth_handler_ta_test.go — Story 1.6 TA expansion (P2/P3).
//
// Handler-layer fault injection validating the post-review patches:
// init-time invite errors (P3), OAuthNotConfiguredError → 503 (P6),
// userinfo timeout → google_timeout (P4), invite-email-mismatch URL
// no longer leaks emails (P7).
//
// Helpers reused from google_oauth_handler_atdd_test.go:
// newGoogleHandlerHarness, mockGoogleOAuthClient.

package handler_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
)

// ----- shared seed helper for invite rows used by Google init tests --

func seedInviteForInitTest(t *testing.T, db *test.TxDB, email, role, tokenHash string, expiresAt time.Time) string {
	t.Helper()
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")
	var id string
	if err := db.QueryRow(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 RETURNING id`,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		email, role, tokenHash, expiresAt,
	).Scan(&id); err != nil {
		t.Fatalf("seed invite: %v", err)
	}
	return id
}

// TestGoogleInit_AC10_InviteExpired_Returns410 (#9) validates patch P3:
// expired invite at /api/auth/google now returns 410, not 500.
func TestGoogleInit_AC10_InviteExpired_Returns410(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	rawToken := "ta-init-expired-token"
	seedInviteForInitTest(t, db, "expired@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(-1*time.Hour),
	)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google?inviteToken="+rawToken, nil)
	ctx := context.WithValue(req.Context(), requestIDFixture, "ta-init-expired")
	req = req.WithContext(ctx)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	if rec.Code != http.StatusGone {
		t.Fatalf("status: want 410, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVITE_EXPIRED") {
		t.Errorf("body should mention INVITE_EXPIRED, got %q", rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "Tenant A") {
		t.Errorf("details.centerName missing: %q", rec.Body.String())
	}
}

// TestGoogleInit_AC10_InviteAlreadyAccepted_Returns409 (#10) validates
// patch P3 for the already-accepted branch.
func TestGoogleInit_AC10_InviteAlreadyAccepted_Returns409(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, db := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	rawToken := "ta-init-accepted-token"
	inviteID := seedInviteForInitTest(t, db, "accepted@example.com", "teacher",
		hashInviteTokenForHandlerTest(rawToken),
		mockClock.Now().Add(7*24*time.Hour),
	)
	if _, err := db.Exec(context.Background(),
		`UPDATE invites SET accepted_at = $2 WHERE id = $1`,
		inviteID, mockClock.Now(),
	); err != nil {
		t.Fatalf("pre-mark accepted: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google?inviteToken="+rawToken, nil)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("status: want 409, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVITE_ALREADY_ACCEPTED") {
		t.Errorf("body should mention INVITE_ALREADY_ACCEPTED, got %q", rec.Body.String())
	}
}

// TestGoogleInit_OAuthNotConfigured_Returns503 (#11) validates patch P6:
// when SetGoogleOAuth was never called (operator left env empty),
// the init endpoint returns 503 OAUTH_NOT_CONFIGURED, not 500.
func TestGoogleInit_OAuthNotConfigured_Returns503(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	db := test.SetupDB(t)
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	// NOTE: SetGoogleOAuth NOT called — this is the "dev parity / missing env" case.
	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	h := handler.NewAuthHandler(svc, cookieCfg)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google", nil)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "OAUTH_NOT_CONFIGURED") {
		t.Errorf("body should mention OAUTH_NOT_CONFIGURED, got %q", rec.Body.String())
	}
}

// TestGoogleCallback_OAuthNotConfigured_Returns503Envelope (#12) — the
// callback path also surfaces OAuthNotConfiguredError as a 503 envelope
// (not a 302), so monitoring picks it up.
func TestGoogleCallback_OAuthNotConfigured_Returns503Envelope(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	db := test.SetupDB(t)
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	svc.SetAppPostLoginURL("http://localhost:5173/")
	svc.SetAppLoginErrorURLBase("http://localhost:5173/login")
	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	h := handler.NewAuthHandler(svc, cookieCfg)

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?code=any&state=any", nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: "any"})
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusServiceUnavailable {
		t.Fatalf("status: want 503 envelope (not 302), got %d", rec.Code)
	}
	if !strings.Contains(rec.Body.String(), "OAUTH_NOT_CONFIGURED") {
		t.Errorf("body should mention OAUTH_NOT_CONFIGURED, got %q", rec.Body.String())
	}
}

// TestGoogleCallback_UserinfoTimeout_RedirectsGoogleTimeout (#13)
// validates patch P4: when the userinfo HTTP call hits
// context.DeadlineExceeded, the redirect surface is `?error=google_timeout`
// (NOT `?error=google_userinfo_failed`).
func TestGoogleCallback_UserinfoTimeout_RedirectsGoogleTimeout(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	oauthMock := &mockGoogleOAuthClient{
		userInfoErr: &service.OAuthUserinfoTimeoutError{},
	}
	h, _ := newGoogleHandlerHarness(t, mockClock, oauthMock, false)

	const stateSecret = "test-oauth-state-secret-32-bytes!"
	signer := service.NewOAuthStateSignerWithClock([]byte(stateSecret), mockClock)
	state, err := signer.Sign(service.OAuthStatePayload{
		Nonce: "ta-timeout", IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("sign state: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?code=code&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: state})
	req.Host = "my.classlite.app"
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302 (timeout → redirect), got %d (body=%q)", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=google_timeout") {
		t.Errorf("Location should contain error=google_timeout, got %q", loc)
	}
	if strings.Contains(loc, "google_userinfo_failed") {
		t.Errorf("timeout MUST NOT collapse to google_userinfo_failed: %q", loc)
	}
}

// TestGoogleCallback_InviteEmailMismatch_NoEmailLeakInRedirectURL (#14)
// validates patch P7: the privacy fix. Even when an invite-email
// mismatch produces a recoverable error surface, the URL must NOT
// carry the invited email, the Google email, or the center name —
// only `?error=invite_email_mismatch` (the SPA fetches details via a
// tenant-scoped follow-up call after landing).
func TestGoogleCallback_InviteEmailMismatch_NoEmailLeakInRedirectURL(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	db := test.SetupDB(t)

	// Seed centerA + an invite for invited@example.com.
	centerA := test.CreateCenterWithID(t, db, test.TenantAID, "Tenant A", "TENA")
	inviter := test.CreateUser(t, db, "owner@example.com", "Owner")
	_ = test.TenantContext(t, db, centerA.ID)
	_ = test.CreateCenterMember(t, db, inviter.ID, centerA.ID, "owner")

	rawToken := "ta-mismatch-no-leak-token"
	inviteHash := hashInviteTokenForHandlerTest(rawToken)
	if _, err := db.Exec(context.Background(),
		`INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
		 VALUES ($1, $2, $3, $4, $5, $6)`,
		test.TenantAID, uuid.UUID(inviter.ID.Bytes).String(),
		"invited@example.com", "teacher",
		inviteHash, mockClock.Now().Add(7*24*time.Hour),
	); err != nil {
		t.Fatalf("seed invite: %v", err)
	}

	// The actor's Google account is a DIFFERENT email.
	oauthMock := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub: "google-sub-other", Email: "different@example.com",
			EmailVerified: true, Name: "Different Person",
		},
	}
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	const stateSecret = "test-oauth-state-secret-32-bytes!"
	svc.SetGoogleOAuth(oauthMock, service.NewOAuthStateSignerWithClock([]byte(stateSecret), mockClock))
	svc.SetAppApexHost("my.classlite.app")
	svc.SetAppPostLoginURL("http://localhost:5173/")
	svc.SetAppLoginErrorURLBase("http://localhost:5173/login")
	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	h := handler.NewAuthHandler(svc, cookieCfg)

	// State payload binds the invite-token hash so the callback runs the
	// invite-bind step and surfaces the mismatch.
	signer := service.NewOAuthStateSignerWithClock([]byte(stateSecret), mockClock)
	state, err := signer.Sign(service.OAuthStatePayload{
		Nonce:           "ta-mismatch",
		InviteTokenHash: inviteHash,
		IssuedAt:        mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("sign state: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?code=code&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: state})
	req.Host = "my.classlite.app"
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302 (login succeeds, invite rejected), got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	// MUST carry the error code.
	if !strings.Contains(loc, "error=invite_email_mismatch") {
		t.Errorf("Location should contain error=invite_email_mismatch, got %q", loc)
	}
	// MUST NOT leak the invited email, the Google email, or the center name.
	forbidden := []string{
		"invited@example.com",
		"different@example.com",
		"expectedEmail=",
		"googleEmail=",
		"center=",
		"Tenant",
	}
	for _, leak := range forbidden {
		if strings.Contains(loc, leak) {
			t.Errorf("Location MUST NOT contain %q (privacy/Referer leak): got %q", leak, loc)
		}
	}
	// Bonus assertion: confirm the response is encoded as a URL (no JSON
	// envelope, since the SPA needs to navigate to the dashboard).
	if _, err := json.Marshal(loc); err != nil {
		t.Fatalf("Location is not a string: %v", err)
	}
}

// requestIDFixture lets us thread a fixed request ID through tests
// that go through ErrorMapper, mirroring the pattern in
// auth_handler_test.go::newReqWithRequestID.
type requestIDFixtureKey struct{}

var requestIDFixture = requestIDFixtureKey{}
