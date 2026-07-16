// Story 2.5c — Google Meet OAuth test-server helper.
//
// Layers the 3 new routes onto the 2-5b settings mux with a MOCK Google
// OAuth client (no real Google round-trip in unit tests — see FU-2-5-N for
// the Playwright deferral). The stub returns a fixed access+refresh token
// pair so happy-path callback tests can assert token persistence + flag flip.
//
// Two constructors mirror 2-5b:
//   - NewSettings2_5CTestServerForUser — generous rate limit (60/min).
//   - NewSettings2_5CTestServerRateLimited — pinned 5/min per (center, IP)
//     so the 429 Retry-After assertion lands deterministically.
package test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/middleware"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
	"golang.org/x/oauth2"
	"golang.org/x/time/rate"
)

// StubMeet2_5CClient is the exported stub GoogleMeetOAuthClient used by
// handler tests. LastState records the last state passed to AuthCodeURL
// so tests can pluck it and feed it into the callback. ExchangeErr forces
// the code-exchange branch to fail (INTEGRATION_CONNECT_FAILED test).
//
// P12 fix (2026-07-16 code review Chunk 2, Blind Hunter #10): `NowFn` is
// injected by the server constructors so `Token.Expiry` derives from the
// same mock clock as the rest of the test (was `time.Now()` — wall clock,
// flaked under long CI runs).
type StubMeet2_5CClient struct {
	LastState        string
	AuthCodeURLValue string
	ExchangeErr      error
	NowFn            func() time.Time // if nil, defaults to time.Now
}

func (s *StubMeet2_5CClient) AuthCodeURL(state string) string {
	s.LastState = state
	if s.AuthCodeURLValue != "" {
		return s.AuthCodeURLValue
	}
	return "https://accounts.google.com/o/oauth2/v2/auth?state=" + state
}

func (s *StubMeet2_5CClient) Exchange(_ context.Context, _ string) (*oauth2.Token, error) {
	if s.ExchangeErr != nil {
		return nil, s.ExchangeErr
	}
	now := time.Now
	if s.NowFn != nil {
		now = s.NowFn
	}
	return &oauth2.Token{
		AccessToken:  "stub-access-token",
		RefreshToken: "stub-refresh-token",
		TokenType:    "Bearer",
		Expiry:       now().Add(time.Hour),
	}, nil
}

// Meet2_5CTestKey is a deterministic 32-byte AES-256 key for Seal/Open in
// handler tests. Distinct from config.devIntegrationsEncryptionKey so a
// dev-fallback regression cannot mask a real handler-test failure.
func Meet2_5CTestKey() []byte {
	out := make([]byte, 32)
	for i := range out {
		out[i] = byte(i) ^ 0x7C
	}
	return out
}

// Meet2_5CTestStateSecret pins the HMAC secret so the signer + verifier
// share the same key across the handler test file.
const Meet2_5CTestStateSecret = "test-oauth-state-secret-32-bytes!"

// SignMeet2_5CStateWithBinding produces an HMAC-signed OAuth state token
// with an arbitrary (centerID, userID) binding pair. Used by handler tests
// to construct MISMATCH scenarios: pass a state whose CenterID or UserID
// does not match the callback's session tc, then assert 403
// OAUTH_STATE_MISMATCH. P4 fix helper (Round 1 code review Chunk 2, 2026-07-16).
func SignMeet2_5CStateWithBinding(t *testing.T, mockClk *clock.MockClock, centerID, userID string) string {
	t.Helper()
	signer := service.NewOAuthStateSignerWithClock([]byte(Meet2_5CTestStateSecret), mockClk)
	signed, err := signer.Sign(service.OAuthStatePayload{
		Nonce:    "meet-2-5c-test-mismatch-nonce",
		IssuedAt: mockClk.Now().Unix(),
		CenterID: centerID,
		UserID:   userID,
	})
	if err != nil {
		t.Fatalf("sign meet state: %v", err)
	}
	return signed
}

// Meet2_5CTestPostConnectURL is the SPA URL the callback handler appends
// `?tab=integrations&status=connected` to. Tests parse this back to
// assert the redirect target.
const Meet2_5CTestPostConnectURL = "http://localhost:5173/settings"

// NewSettings2_5CTestServerForUser mounts the 3 Meet routes onto the
// full settings mux (2-5a + 2-5b + 2-5c). Returns the stub client so
// tests can pluck LastState + inject Exchange errors.
func NewSettings2_5CTestServerForUser(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	mockClk *clock.MockClock,
) (http.Handler, *StubMeet2_5CClient) {
	t.Helper()
	stub := &StubMeet2_5CClient{}
	srv := newSettings2_5CSrv(t, db, rate.Every(60*time.Second), 60, stub, mockClk)
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: srv, token: tok}, stub
}

// NewSettings2_5CTestServerRateLimited pins the Meet callback rate limit
// to 1 req/min so the 429 assertion is deterministic without flooding a
// real 5-req bucket. Story spec AC9 says 5/min per (center, IP) — we
// tighten to 1/min in tests for the same reason 2-5a did.
func NewSettings2_5CTestServerRateLimited(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	mockClk *clock.MockClock,
) (http.Handler, *StubMeet2_5CClient) {
	t.Helper()
	stub := &StubMeet2_5CClient{}
	srv := newSettings2_5CSrv(t, db, rate.Every(time.Minute), 1, stub, mockClk)
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: srv, token: tok}, stub
}

// NewSettings2_5CTestServerWithRevokedMembership wires the same server as
// NewSettings2_5CTestServerForUser but overrides the fresh-membership check
// to always return false (owner was demoted between authorize and callback).
// Used by the OAUTH_MEMBERSHIP_REVOKED handler test — spec AC5 step 3 fresh
// membership re-check. P5 fix (Round 1 code review Chunk 2, 2026-07-16).
func NewSettings2_5CTestServerWithRevokedMembership(
	t *testing.T,
	db storyDB,
	userID pgtype.UUID,
	centerID string,
	mockClk *clock.MockClock,
) (http.Handler, *StubMeet2_5CClient) {
	t.Helper()
	stub := &StubMeet2_5CClient{}
	srv := newSettings2_5CSrvWithMembershipOverride(
		t, db, rate.Every(60*time.Second), 60, stub, mockClk,
		func(_ context.Context, _, _ uuid.UUID) (bool, error) { return false, nil },
	)
	tok := SignAccessTokenForOwner(t, userID, centerID)
	return &authInjectingHandler{next: srv, token: tok}, stub
}

func newSettings2_5CSrv(
	t *testing.T,
	db storyDB,
	rps rate.Limit,
	burst int,
	oauthStub *StubMeet2_5CClient,
	mockClk *clock.MockClock,
) http.Handler {
	// Skip real membership DB lookup in tests — the caller creates an Owner
	// via CenterService.CreateCenter, so the check would always pass anyway.
	return newSettings2_5CSrvWithMembershipOverride(t, db, rps, burst, oauthStub, mockClk,
		func(_ context.Context, _, _ uuid.UUID) (bool, error) { return true, nil })
}

func newSettings2_5CSrvWithMembershipOverride(
	t *testing.T,
	db storyDB,
	rps rate.Limit,
	burst int,
	oauthStub *StubMeet2_5CClient,
	mockClk *clock.MockClock,
	membershipCheck func(context.Context, uuid.UUID, uuid.UUID) (bool, error),
) http.Handler {
	t.Helper()

	// Reuse the 2-5b mux which layers on the 2-5a mux.
	mux := newSettings2_5BSrv(t, db, rate.Every(60*time.Second), 60).(*http.ServeMux)

	auditSvc := service.NewAuditService(db)
	signer := service.NewOAuthStateSignerWithClock([]byte(Meet2_5CTestStateSecret), mockClk)
	meetSvc := service.NewGoogleMeetService(
		db, oauthStub, signer, auditSvc, mockClk, Meet2_5CTestKey(),
	)
	meetSvc.SetOwnerMembershipCheck(membershipCheck)
	// P12 fix: bind stub OAuth client's Token.Expiry clock to the same mock
	// as the service so downstream assertions on persisted expiry are
	// deterministic across long test runs.
	if oauthStub.NowFn == nil {
		oauthStub.NowFn = mockClk.Now
	}
	meetHandler := handler.NewGoogleMeetHandler(meetSvc, mockClk, Meet2_5CTestPostConnectURL)

	extractTenant := middleware.ExtractTenant(db, jwtSigner())
	requireVerified := middleware.RequireVerifiedEmail()
	requireCenter := middleware.RequireCenterContext()
	requireOwner := middleware.RequireRole("owner")
	settingsLimit := middleware.RateLimitByKey(
		"settings-2-5c-test-"+uuid.NewString(),
		rate.Every(60*time.Second), 60,
		middleware.UserAndIPKeyFn,
	)
	callbackLimit := middleware.RateLimitByKey(
		"oauth-callback-2-5c-test-"+uuid.NewString(),
		rps, burst,
		middleware.CenterAndIPKeyFn,
	)

	ownerChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(requireOwner(settingsLimit(http.HandlerFunc(middleware.ErrorMapper(h)))))))
	}
	callbackChain := func(h middleware.HandlerWithError) http.Handler {
		return extractTenant(requireVerified(requireCenter(callbackLimit(http.HandlerFunc(middleware.ErrorMapper(h))))))
	}

	mux.Handle("GET /api/centers/{id}/integrations/google-meet/authorize", ownerChain(meetHandler.Authorize))
	mux.Handle("DELETE /api/centers/{id}/integrations/google-meet", ownerChain(meetHandler.Disconnect))
	mux.Handle("GET /api/centers/callback/google-meet", callbackChain(meetHandler.Callback))
	return mux
}
