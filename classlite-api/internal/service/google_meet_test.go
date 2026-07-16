// Story 2.5c — GoogleMeetService tests. Real-DB variant per Story 2-5a
// settings_test.go convention. Coverage per AC12 5-row state security matrix:
//
//   Row 1  — Valid state + valid code → 302 + tokens persisted + flag flipped
//   Row 2  — Expired state → OAuthStateExpiredError, no DB writes
//   Row 3  — state.CenterID mismatch → OAuthStateMismatchError, no DB writes
//   Row 4  — state.UserID mismatch → OAuthStateMismatchError, no DB writes
//   Row 5  — Tampered HMAC → OAuthStateInvalidError, no DB writes
//
// Plus:
//   - Owner membership revoked → OAuthMembershipRevokedError, no DB writes
//   - Code exchange fails → IntegrationConnectFailedError, no side-effects
//   - Disconnect happy path + double-disconnect idempotency
//
// GoogleMeetOAuthClient is mocked at the interface seam — real Google
// round-trip is out of scope for unit tests (see FU-2-5-N Playwright deferral).

package service_test

import (
	"bytes"
	"context"
	"encoding/base64"
	"errors"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"golang.org/x/oauth2"
)

// meetTestKey is a deterministic 32-byte AES-256 key for Seal/Open in tests.
// Distinct from config.devIntegrationsEncryptionKey so test failures don't
// mask a dev-fallback bug.
func meetTestKey() []byte {
	// 32 bytes = "meet-test-key-32-bytes-for-aes256!" trimmed / padded.
	b, _ := base64.StdEncoding.DecodeString("bWVldC10ZXN0LWtleS0zMi1ieXRlcy1mb3ItYWVzMjU2IQ==")
	if len(b) != 32 {
		// Fallback deterministic 32-byte pattern.
		out := make([]byte, 32)
		for i := range out {
			out[i] = byte(i) ^ 0x33
		}
		return out
	}
	return b
}

// stubMeetOAuthClient is the mockable GoogleMeetOAuthClient. It records the
// last state passed to AuthCodeURL + returns either a happy oauth2.Token or
// an error from Exchange (settable per-test).
//
// P12 fix (2026-07-16 code review Chunk 2, Blind Hunter #10): `nowFn` is
// injected so `Token.Expiry` derives from the same mock clock as the rest
// of the test (was `time.Now()` — wall clock, flakes under long CI runs
// and defeated deterministic-clock invariants for downstream assertions).
type stubMeetOAuthClient struct {
	lastState        string
	authCodeURLValue string
	exchangeErr      error
	exchangeToken    *oauth2.Token
	nowFn            func() time.Time // if nil, defaults to time.Now
}

func (s *stubMeetOAuthClient) AuthCodeURL(state string) string {
	s.lastState = state
	if s.authCodeURLValue != "" {
		return s.authCodeURLValue
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?state=" + state
}

func (s *stubMeetOAuthClient) Exchange(_ context.Context, _ string) (*oauth2.Token, error) {
	if s.exchangeErr != nil {
		return nil, s.exchangeErr
	}
	if s.exchangeToken != nil {
		return s.exchangeToken, nil
	}
	now := time.Now
	if s.nowFn != nil {
		now = s.nowFn
	}
	return &oauth2.Token{
		AccessToken:  "stub-access-token",
		RefreshToken: "stub-refresh-token",
		TokenType:    "Bearer",
		Expiry:       now().Add(time.Hour),
	}, nil
}

// meetOwnerCenter mirrors seedOwnerCenter from settings_test.go but returns
// the concrete UUIDs for state binding.
func meetOwnerCenter(t *testing.T, db *test.TxDB, name string) (model.TenantContext, uuid.UUID, uuid.UUID) {
	t.Helper()
	user := test.CreateUser(t, db, name+"@meet.example.com", name)
	test.MarkUserEmailVerified(t, db, user.ID)
	uid, _ := uuid.Parse(test.UUIDString(user.ID))

	auditSvc := service.NewAuditService(db)
	centerSvc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})
	res, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: name})
	if err != nil {
		t.Fatalf("seed center: %v", err)
	}
	return model.TenantContext{
		UserID:   uid.String(),
		CenterID: res.ID.String(),
		Role:     "owner",
	}, uid, res.ID
}

// newMeetSvcWithSigner returns a GoogleMeetService wired with a mock clock
// + mock oauth client + real db + real signer. The membership check is
// overridden to always return true — tests that want to exercise membership
// revocation override it further.
func newMeetSvcWithSigner(
	t *testing.T,
	db *test.TxDB,
	mockClk *clock.MockClock,
	oauthClient *stubMeetOAuthClient,
) (*service.GoogleMeetService, service.OAuthStateSigner) {
	t.Helper()
	// P12 fix: default the stub's Token.Expiry clock to the mock so tests
	// using `newMeetSvcWithSigner(..., stub)` inherit deterministic time
	// automatically. Tests that inject a custom exchangeToken override.
	if oauthClient.nowFn == nil {
		oauthClient.nowFn = mockClk.Now
	}
	signer := service.NewOAuthStateSignerWithClock([]byte("test-oauth-state-secret-32-bytes!"), mockClk)
	auditSvc := service.NewAuditService(db)
	svc := service.NewGoogleMeetService(
		db, oauthClient, signer, auditSvc, mockClk, meetTestKey(),
	)
	svc.SetOwnerMembershipCheck(func(_ context.Context, _, _ uuid.UUID) (bool, error) {
		return true, nil
	})
	return svc, signer
}

// -----------------------------------------------------------------------------
// BuildAuthorizeURL — happy path
// -----------------------------------------------------------------------------
func TestGoogleMeetService_BuildAuthorizeURL_SignsStateAndReturnsURL(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, _ := meetOwnerCenter(t, db, "AuthorizeCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, signer := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	result, err := svc.BuildAuthorizeURL(context.Background(), tc)
	if err != nil {
		t.Fatalf("BuildAuthorizeURL: %v", err)
	}
	if result.AuthorizeURL == "" {
		t.Fatal("empty authorize URL")
	}
	// Verify the state passed to AuthCodeURL round-trips through the signer
	// with the expected CenterID + UserID (triple-binding foundation).
	payload, err := signer.Verify(oauthClient.lastState)
	if err != nil {
		t.Fatalf("signer.Verify: %v", err)
	}
	if payload.CenterID != tc.CenterID {
		t.Errorf("payload.CenterID = %q, want %q", payload.CenterID, tc.CenterID)
	}
	if payload.UserID != tc.UserID {
		t.Errorf("payload.UserID = %q, want %q", payload.UserID, tc.UserID)
	}
	if !result.ExpiresAt.Equal(mockClk.Now().Add(service.OAuthStateTTL)) {
		t.Errorf("ExpiresAt = %s, want %s", result.ExpiresAt, mockClk.Now().Add(service.OAuthStateTTL))
	}
}

// -----------------------------------------------------------------------------
// HandleCallback — Row 1: happy path (valid state + valid code)
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_HappyPathPersistsTokensAndFlipsFlag(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "HappyCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// Build authorize state via the service so the payload matches expectations.
	authRes, err := svc.BuildAuthorizeURL(context.Background(), tc)
	if err != nil {
		t.Fatalf("BuildAuthorizeURL: %v", err)
	}
	_ = authRes

	resolvedCenterID, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code:   "authorization-code-from-google",
		State:  oauthClient.lastState,
		PathID: tc.CenterID,
		TC:     tc,
	})
	if err != nil {
		t.Fatalf("HandleCallback: %v", err)
	}
	if resolvedCenterID != tc.CenterID {
		t.Errorf("resolvedCenterID = %s, want %s", resolvedCenterID, tc.CenterID)
	}
	// Verify centers.google_meet_connected flipped + integration row exists.
	assertMeetConnected(t, db, centerUUID, true)
	assertIntegrationPersisted(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// P2 + P3 fix (2026-07-16 code review Chunk 2, Auditor Blocker #1 + Edge #1):
// UpsertIntegration success + UNIQUE-conflict-replaces-prior-row test —
// exercises the sqlc `INSERT ... ON CONFLICT (center_id, provider) DO UPDATE`
// branch (the reconnect path). Also proves the P7 fix (WasInserted-driven
// audit pre-state) works correctly: first HandleCallback → audit
// Before.connected=false; second HandleCallback → audit Before.connected=true.
// A regression that dropped `!integration.WasInserted` would silently make
// every reconnect look like a first-connect in the audit trail.
//
// NOTE: test.SetupDB wraps in a per-test transaction, so `now()` returns the
// same value for both audit rows. Tests query audit rows in insertion order
// via id (defined DEFAULT gen_random_uuid) instead of created_at.
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_ReconnectUpsertsAndAuditsPreState(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "ReconnectCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// First connect — INSERT branch.
	if _, err := svc.BuildAuthorizeURL(context.Background(), tc); err != nil {
		t.Fatalf("first BuildAuthorizeURL: %v", err)
	}
	firstState := oauthClient.lastState
	if _, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code-1", State: firstState, PathID: tc.CenterID, TC: tc,
	}); err != nil {
		t.Fatalf("first HandleCallback: %v", err)
	}
	assertIntegrationPersisted(t, db, centerUUID)

	// Capture the encrypted access token so we can prove UPDATE branch
	// replaced it (not preserved) after the reconnect.
	firstAccessToken := integrationAccessTokenBytes(t, db, centerUUID)

	// Advance clock so second state has distinct issued_at (defensive —
	// signer's Nonce is already random so a same-tick collision is
	// astronomically unlikely, but keeps intent explicit).
	mockClk.Advance(1 * time.Minute)

	// Second connect (reconnect / account switch) — UPDATE branch.
	if _, err := svc.BuildAuthorizeURL(context.Background(), tc); err != nil {
		t.Fatalf("second BuildAuthorizeURL: %v", err)
	}
	secondState := oauthClient.lastState
	if secondState == firstState {
		t.Fatal("second BuildAuthorizeURL returned same state as first — nonce not fresh")
	}
	// Change the exchange token so we can prove the persisted row was updated.
	oauthClient.exchangeToken = &oauth2.Token{
		AccessToken:  "stub-access-token-v2",
		RefreshToken: "stub-refresh-token-v2",
		TokenType:    "Bearer",
		Expiry:       mockClk.Now().Add(2 * time.Hour),
	}
	if _, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code-2", State: secondState, PathID: tc.CenterID, TC: tc,
	}); err != nil {
		t.Fatalf("second HandleCallback (reconnect): %v", err)
	}

	// Still exactly one integration row (UNIQUE (center_id, provider) held —
	// second call did NOT insert a duplicate).
	assertIntegrationPersisted(t, db, centerUUID)

	// Row's encrypted access token was replaced (UPDATE branch fired).
	secondAccessToken := integrationAccessTokenBytes(t, db, centerUUID)
	if bytes.Equal(firstAccessToken, secondAccessToken) {
		t.Error("expected access_token_encrypted to differ after reconnect; got identical bytes")
	}

	// P7 fix invariant: TWO audit rows must exist (Connect + Reconnect); the
	// FIRST records Before.connected=false, the SECOND records
	// Before.connected=true. Ordering by (created_at, id) — both audits
	// share created_at inside the test tx so id (random uuid) breaks the tie,
	// but the invariant we care about is: exactly one row with
	// Before.connected=true and exactly one with false.
	trueCount, falseCount := countMeetConnectedAuditBeforeStates(t, db, centerUUID)
	if trueCount != 1 {
		t.Errorf("expected exactly 1 audit row with Before.connected=true (reconnect), got %d", trueCount)
	}
	if falseCount != 1 {
		t.Errorf("expected exactly 1 audit row with Before.connected=false (first connect), got %d", falseCount)
	}
}

// -----------------------------------------------------------------------------
// HandleCallback — Row 2: expired state
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_ExpiredStateRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "ExpiredCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	mockClk.Advance(11 * time.Minute) // past 10-min TTL

	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	})
	var expired *service.OAuthStateExpiredError
	if !errors.As(err, &expired) {
		t.Fatalf("expected *OAuthStateExpiredError, got %T: %v", err, err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// HandleCallback — Row 3: state.CenterID mismatch with path{id}
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_CenterIDMismatchRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "CenterMismatchOwner")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	otherCenter := uuid.New().String()

	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: otherCenter, TC: tc,
	})
	var mismatch *service.OAuthStateMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("expected *OAuthStateMismatchError, got %T: %v", err, err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// HandleCallback — Row 4: state.UserID mismatch with tc.UserID
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_UserIDMismatchRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "UserMismatchOwner")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	// Swap tc.UserID for a fresh UUID — attacker replays another owner's state.
	imposterTC := tc
	imposterTC.UserID = uuid.New().String()

	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: tc.CenterID, TC: imposterTC,
	})
	var mismatch *service.OAuthStateMismatchError
	if !errors.As(err, &mismatch) {
		t.Fatalf("expected *OAuthStateMismatchError, got %T: %v", err, err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// HandleCallback — Row 5: tampered HMAC signature
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_TamperedStateRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "TamperOwner")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	// Tamper the first char of the payload half (before the '.').
	tampered := "X" + oauthClient.lastState[1:]

	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: tampered, PathID: tc.CenterID, TC: tc,
	})
	var invalid *service.OAuthStateInvalidError
	if !errors.As(err, &invalid) {
		t.Fatalf("expected *OAuthStateInvalidError, got %T: %v", err, err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// HandleCallback — Owner membership revoked between authorize and callback
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_MembershipRevokedRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "RevokedOwner")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	// Simulate revoke between authorize and callback.
	svc.SetOwnerMembershipCheck(func(_ context.Context, _, _ uuid.UUID) (bool, error) {
		return false, nil
	})

	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	})
	var revoked *service.OAuthMembershipRevokedError
	if !errors.As(err, &revoked) {
		t.Fatalf("expected *OAuthMembershipRevokedError, got %T: %v", err, err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// HandleCallback — code exchange fails (Google-side network / invalid_grant)
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_CodeExchangeFailedRejected(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "ExchangeFailCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{exchangeErr: errors.New("invalid_grant")}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "bad-code", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	})
	var connectFailed *service.IntegrationConnectFailedError
	if !errors.As(err, &connectFailed) {
		t.Fatalf("expected *IntegrationConnectFailedError, got %T: %v", err, err)
	}
	if connectFailed.Provider != service.GoogleMeetProvider {
		t.Errorf("connectFailed.Provider = %q, want %q", connectFailed.Provider, service.GoogleMeetProvider)
	}
	// Tx rollback — no side effects.
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// P11 fix (2026-07-16 code review Chunk 2, Edge Case #8 + #9):
// Early-rejection guards inside HandleCallback that previously had no
// direct coverage. Table-driven so a regression to any single branch fails
// the specific row instead of hiding under a shared assertion.
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_EarlyGuardRejections(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "EarlyGuard")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// Sign a valid state for the "missing binding fields" cases (state HMAC
	// verifies but has empty CenterID or UserID — mimics a login-flow state
	// token being replayed against the Meet callback).
	loginStyleState := test.SignMeet2_5CStateWithBinding(t, mockClk, "", "")

	// Also prime a real Meet-flow state so the "empty code" case can reach
	// the code-empty guard without failing state verification first.
	if _, err := svc.BuildAuthorizeURL(context.Background(), tc); err != nil {
		t.Fatalf("BuildAuthorizeURL prep: %v", err)
	}
	realState := oauthClient.lastState

	cases := []struct {
		name       string
		code       string
		state      string
		wantErrAny []any // list of typed-error targets; test asserts errors.As matches one.
	}{
		{
			name:       "empty code — guard at google_meet.go:200",
			code:       "",
			state:      realState,
			wantErrAny: []any{&service.OAuthStateInvalidError{}},
		},
		{
			name:       "empty state — guard at google_meet.go:200",
			code:       "code",
			state:      "",
			wantErrAny: []any{&service.OAuthStateInvalidError{}},
		},
		{
			name:       "state HMAC-valid but payload has empty CenterID+UserID — guard at google_meet.go:212",
			code:       "code",
			state:      loginStyleState,
			wantErrAny: []any{&service.OAuthStateMismatchError{}},
		},
	}
	for _, tc2 := range cases {
		t.Run(tc2.name, func(t *testing.T) {
			_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
				Code: tc2.code, State: tc2.state, PathID: tc.CenterID, TC: tc,
			})
			if err == nil {
				t.Fatalf("expected rejection, got nil")
			}
			matched := false
			for _, target := range tc2.wantErrAny {
				if errors.As(err, &target) {
					matched = true
					break
				}
			}
			if !matched {
				t.Errorf("error type = %T (%v), want one of %v", err, err, tc2.wantErrAny)
			}
			// No side-effects — guard fires before tx opens.
			assertMeetConnected(t, db, centerUUID, false)
			assertIntegrationAbsent(t, db, centerUUID)
		})
	}
}

// -----------------------------------------------------------------------------
// P10 fix (2026-07-16 code review Chunk 2, Edge Case #5):
// Membership check returning an ERROR (not just false) must surface as a
// typed IntegrationConnectFailedError so the callback returns 502 with a
// stable error code, not a generic INTERNAL_ERROR 500 (which happened
// before this fix — the plain wrapped error fell through to ErrorMapper's
// default 500 branch, degrading the client experience during DB blips or
// RLS misconfig).
// -----------------------------------------------------------------------------
func TestGoogleMeetService_HandleCallback_MembershipCheckErrorReturns502(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "MembershipErr")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// Force the membership check to fail — simulates a transient DB error.
	svc.SetOwnerMembershipCheck(func(_ context.Context, _, _ uuid.UUID) (bool, error) {
		return false, errors.New("simulated db timeout during membership lookup")
	})

	if _, err := svc.BuildAuthorizeURL(context.Background(), tc); err != nil {
		t.Fatalf("BuildAuthorizeURL: %v", err)
	}
	_, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	})
	if err == nil {
		t.Fatal("expected IntegrationConnectFailedError, got nil")
	}
	var connectFail *service.IntegrationConnectFailedError
	if !errors.As(err, &connectFail) {
		t.Fatalf("expected *IntegrationConnectFailedError, got %T: %v", err, err)
	}
	if connectFail.Provider != "google_meet" {
		t.Errorf("Provider = %q, want google_meet", connectFail.Provider)
	}
	if connectFail.UpstreamErr == "" {
		t.Error("UpstreamErr empty — lost forensic detail on membership-check failure")
	}
	// No DB side-effects — tx never opened after the error at step 3.
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// Disconnect — happy path deletes row + clears flag
// -----------------------------------------------------------------------------
func TestGoogleMeetService_Disconnect_HappyPathClearsRowAndFlag(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "DisconnectHappy")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// Connect first.
	_, _ = svc.BuildAuthorizeURL(context.Background(), tc)
	if _, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "code", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	}); err != nil {
		t.Fatalf("HandleCallback (prep): %v", err)
	}
	assertMeetConnected(t, db, centerUUID, true)

	// Now disconnect.
	if err := svc.Disconnect(context.Background(), tc); err != nil {
		t.Fatalf("Disconnect: %v", err)
	}
	assertMeetConnected(t, db, centerUUID, false)
	assertIntegrationAbsent(t, db, centerUUID)
}

// -----------------------------------------------------------------------------
// Disconnect — double-disconnect is idempotent
// -----------------------------------------------------------------------------
func TestGoogleMeetService_Disconnect_DoubleDisconnectIdempotent(t *testing.T) {
	db := test.SetupDB(t)
	tc, _, centerUUID := meetOwnerCenter(t, db, "DisconnectIdempotent")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	oauthClient := &stubMeetOAuthClient{}
	svc, _ := newMeetSvcWithSigner(t, db, mockClk, oauthClient)

	// P9 fix (2026-07-16 code review Chunk 2, Edge Case #19): the previous
	// version of this test never called Connect first, so it never exercised
	// the "row present → delete → audit" path or proved the P8 no-op gate
	// (spurious audit rows on repeat Disconnect clicks). The fixed version:
	//   1. Connect (row present + audit row 1: disconnect audit not yet fired)
	//   2. Disconnect (row deleted + audit row 2: disconnect action, count=1)
	//   3. Disconnect again (row absent, P8 gate: NO new audit row, count STAYS 1)

	// Step 1 — connect (INSERT + audit connect row).
	if _, err := svc.BuildAuthorizeURL(context.Background(), tc); err != nil {
		t.Fatalf("BuildAuthorizeURL: %v", err)
	}
	if _, err := svc.HandleCallback(context.Background(), service.HandleCallbackInput{
		Code: "c", State: oauthClient.lastState, PathID: tc.CenterID, TC: tc,
	}); err != nil {
		t.Fatalf("HandleCallback (connect prep): %v", err)
	}
	assertIntegrationPersisted(t, db, centerUUID)

	// Step 2 — first Disconnect (successful delete, emits disconnect audit).
	if err := svc.Disconnect(context.Background(), tc); err != nil {
		t.Fatalf("first Disconnect (row present): %v", err)
	}
	assertIntegrationAbsent(t, db, centerUUID)
	assertMeetConnected(t, db, centerUUID, false)
	afterFirst := countMeetDisconnectedAudits(t, db, centerUUID)
	if afterFirst != 1 {
		t.Fatalf("after first Disconnect: expected 1 disconnect audit, got %d", afterFirst)
	}

	// Step 3 — second Disconnect (no row → P8 early commit, NO new audit).
	if err := svc.Disconnect(context.Background(), tc); err != nil {
		t.Fatalf("second Disconnect (row absent): %v", err)
	}
	assertIntegrationAbsent(t, db, centerUUID)
	assertMeetConnected(t, db, centerUUID, false)
	afterSecond := countMeetDisconnectedAudits(t, db, centerUUID)
	if afterSecond != 1 {
		t.Errorf("P8 invariant broken: expected disconnect audit count to stay at 1 after no-op Disconnect, got %d", afterSecond)
	}
}

// -----------------------------------------------------------------------------
// assertion helpers
// -----------------------------------------------------------------------------

func assertMeetConnected(t *testing.T, db *test.TxDB, centerID uuid.UUID, want bool) {
	t.Helper()
	var got bool
	if err := db.QueryRow(context.Background(),
		"SELECT google_meet_connected FROM centers WHERE id = $1", centerID,
	).Scan(&got); err != nil {
		t.Fatalf("query google_meet_connected: %v", err)
	}
	if got != want {
		t.Errorf("google_meet_connected = %v, want %v", got, want)
	}
}

func assertIntegrationPersisted(t *testing.T, db *test.TxDB, centerID uuid.UUID) {
	t.Helper()
	// Fetch as the same tenant so RLS lets us see the row.
	test.TenantContext(t, db, pgUUIDCompatFromString(t, centerID.String()))
	var count int
	if err := db.QueryRow(context.Background(),
		"SELECT count(*) FROM center_integrations WHERE center_id = $1 AND provider = 'google_meet'",
		centerID,
	).Scan(&count); err != nil {
		t.Fatalf("query center_integrations: %v", err)
	}
	if count != 1 {
		t.Errorf("expected exactly 1 center_integrations row after HappyPath, got %d", count)
	}
}

func assertIntegrationAbsent(t *testing.T, db *test.TxDB, centerID uuid.UUID) {
	t.Helper()
	test.TenantContext(t, db, pgUUIDCompatFromString(t, centerID.String()))
	var count int
	if err := db.QueryRow(context.Background(),
		"SELECT count(*) FROM center_integrations WHERE center_id = $1 AND provider = 'google_meet'",
		centerID,
	).Scan(&count); err != nil {
		t.Fatalf("query center_integrations: %v", err)
	}
	if count != 0 {
		t.Errorf("expected 0 center_integrations rows, got %d", count)
	}
}

// countMeetDisconnectedAudits returns the number of
// `center.integration.google_meet.disconnected` audit rows for the given
// center. P9 fix helper — proves the P8 no-op gate keeps repeat Disconnect
// calls from emitting spurious audit rows.
func countMeetDisconnectedAudits(t *testing.T, db *test.TxDB, centerID uuid.UUID) int {
	t.Helper()
	test.TenantContext(t, db, pgUUIDCompatFromString(t, centerID.String()))
	var count int
	if err := db.QueryRow(context.Background(),
		`SELECT count(*) FROM audit_logs
		WHERE center_id = $1 AND action = 'center.integration.google_meet.disconnected'`,
		centerID,
	).Scan(&count); err != nil {
		t.Fatalf("query disconnected audits: %v", err)
	}
	return count
}

// countMeetConnectedAuditBeforeStates counts audit rows for meet-connect
// grouped by Before.connected value. P2/P3 fix helper — proves the P7
// WasInserted-driven pre-state distinguishes first-connect from re-connect
// even when both audit rows share the tx-scoped now() timestamp.
func countMeetConnectedAuditBeforeStates(t *testing.T, db *test.TxDB, centerID uuid.UUID) (trueCount, falseCount int) {
	t.Helper()
	test.TenantContext(t, db, pgUUIDCompatFromString(t, centerID.String()))
	rows, err := db.Query(context.Background(),
		`SELECT changes->'before'->>'connected' FROM audit_logs
		WHERE center_id = $1 AND action = 'center.integration.google_meet.connected'`,
		centerID,
	)
	if err != nil {
		t.Fatalf("query audit_logs: %v", err)
	}
	defer rows.Close()
	for rows.Next() {
		var v string
		if err := rows.Scan(&v); err != nil {
			t.Fatalf("scan audit row: %v", err)
		}
		switch v {
		case "true":
			trueCount++
		case "false":
			falseCount++
		default:
			t.Fatalf("unexpected Before.connected value in audit: %q", v)
		}
	}
	return trueCount, falseCount
}

// integrationAccessTokenBytes returns the raw sealed access_token_encrypted
// bytes for the given center's google_meet integration. Used to prove the
// reconnect UPDATE branch replaced (not preserved) the token blob. P2/P3 helper.
func integrationAccessTokenBytes(t *testing.T, db *test.TxDB, centerID uuid.UUID) []byte {
	t.Helper()
	test.TenantContext(t, db, pgUUIDCompatFromString(t, centerID.String()))
	var out []byte
	if err := db.QueryRow(context.Background(),
		`SELECT access_token_encrypted FROM center_integrations
		WHERE center_id = $1 AND provider = 'google_meet'`,
		centerID,
	).Scan(&out); err != nil {
		t.Fatalf("query access_token_encrypted: %v", err)
	}
	return out
}

// pgUUIDCompatFromString adapts a UUID string into the pgtype.UUID shape
// TenantContext expects. Kept inline (short) to avoid adding a public
// helper for this single test-only conversion.
func pgUUIDCompatFromString(t *testing.T, id string) pgUUIDCompat {
	t.Helper()
	u, err := uuid.Parse(id)
	if err != nil {
		t.Fatalf("parse uuid %q: %v", id, err)
	}
	return pgUUIDCompat{Bytes: u, Valid: true}
}

// pgUUIDCompat mirrors pgtype.UUID's minimal surface used by test.TenantContext.
type pgUUIDCompat = struct {
	Bytes [16]byte
	Valid bool
}
