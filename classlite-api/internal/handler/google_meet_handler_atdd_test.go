// Story 2.5c — GoogleMeetHandler integration tests via
// NewSettings2_5CTestServerForUser. Coverage per AC12 handler tests bullet:
//
//   - Authorize happy path: 200 + envelope with authorizeUrl + expiresAt
//   - Authorize tenant mismatch: 403 TENANT_MISMATCH
//   - Callback happy path: 302 Location = /settings?tab=integrations&status=connected
//   - Callback state expired: 400 OAUTH_STATE_EXPIRED envelope, no side-effects
//   - Callback state.CenterID mismatch: 403 OAUTH_STATE_MISMATCH envelope
//   - Callback state tampered: 400 OAUTH_STATE_INVALID envelope
//   - Callback code exchange fails: 502 INTEGRATION_CONNECT_FAILED envelope
//   - Callback 429 with Retry-After header (Murat-B6 fold)
//   - Disconnect happy path: 204 No Content
//   - Disconnect double: 204 (idempotent)
package handler_test

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgtype"
)

// seedMeetOwnerHandler seeds a verified Owner + center + returns
// (pgUID, centerID) suitable for the 2-5c test server helper.
func seedMeetOwnerHandler(t *testing.T, db *test.TxDB, name string) (pgtype.UUID, string) {
	t.Helper()
	user := test.CreateUser(t, db, name+"@meet-handler.example.com", name)
	test.MarkUserEmailVerified(t, db, user.ID)
	uid := test.MustParseUUID(t, test.UUIDString(user.ID))
	auditSvc := service.NewAuditService(db)
	centerSvc := service.NewCenterService(db, auditSvc, test.MockAccessTokenIssuer{}, clock.RealClock{})
	res, err := centerSvc.CreateCenter(context.Background(), uid, service.CreateCenterInput{Name: name})
	if err != nil {
		t.Fatalf("seed center: %v", err)
	}
	return user.ID, res.ID.String()
}

// -----------------------------------------------------------------------------
// Authorize happy path — 200 envelope with authorizeUrl + expiresAt
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Authorize_HappyPath_ReturnsEnvelope(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "AuthorizeCenter")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	req := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("want 200, got %d — body: %s", rec.Code, rec.Body.String())
	}
	var env struct {
		Data struct {
			AuthorizeURL string `json:"authorizeUrl"`
			ExpiresAt    string `json:"expiresAt"`
		} `json:"data"`
		Meta struct {
			ServerTime string `json:"serverTime"`
		} `json:"meta"`
	}
	if err := json.NewDecoder(rec.Body).Decode(&env); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if env.Data.AuthorizeURL == "" {
		t.Errorf("authorizeUrl empty")
	}
	if env.Data.ExpiresAt == "" {
		t.Errorf("expiresAt empty")
	}
	if env.Meta.ServerTime == "" {
		t.Errorf("meta.serverTime empty")
	}
}

// -----------------------------------------------------------------------------
// Authorize tenant mismatch — 403 TENANT_MISMATCH envelope
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Authorize_TenantMismatchRejected(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "AuthorizeTenantMismatch")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Craft a path with a different center id — Owner's session tc.CenterID
	// won't match, so requireMeetOwnerTenant → TenantMismatchError → 403.
	otherCenter := "11111111-2222-3333-4444-555555555555"
	req := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+otherCenter+"/integrations/google-meet/authorize", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", rec.Code, rec.Body.String())
	}
	assertMeetErrorCode(t, rec.Body.Bytes(), "TENANT_MISMATCH")
}

// -----------------------------------------------------------------------------
// Callback happy path — 302 redirect on success
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_HappyPath_Returns302Redirect(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackHappy")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, stub := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Prime state via authorize.
	authorizeReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	authorizeRec := httptest.NewRecorder()
	srv.ServeHTTP(authorizeRec, authorizeReq)
	if authorizeRec.Code != http.StatusOK {
		t.Fatalf("authorize prep: want 200, got %d", authorizeRec.Code)
	}

	// Callback with primed state.
	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=stub-code&state="+stub.LastState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	loc := cbRec.Header().Get("Location")
	if loc == "" {
		t.Fatal("Location header empty")
	}
	// Expected suffix — order of params from url.Values.Encode is stable
	// (alphabetical: status, tab), so this is a stable substring.
	if !contains(loc, "tab=integrations") || !contains(loc, "status=connected") {
		t.Errorf("Location = %q, want tab=integrations&status=connected", loc)
	}
}

// -----------------------------------------------------------------------------
// Callback state expired — 400 OAUTH_STATE_EXPIRED envelope
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_ExpiredStateReturns400(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackExpired")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, stub := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Prime state.
	authReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	authRec := httptest.NewRecorder()
	srv.ServeHTTP(authRec, authReq)
	// Advance past 10-min TTL.
	mockClk.Advance(11 * time.Minute)

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=stub-code&state="+stub.LastState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "OAUTH_STATE_EXPIRED")
	// P6 fix (no-side-effect assertion): expired state must not persist tokens.
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// Callback tampered state — 400 OAUTH_STATE_INVALID envelope
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_TamperedStateReturns400(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackTamper")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, stub := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Prime state, then tamper.
	authReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	srv.ServeHTTP(httptest.NewRecorder(), authReq)
	tampered := "X" + stub.LastState[1:]

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=stub&state="+tampered, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusBadRequest {
		t.Fatalf("want 400, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "OAUTH_STATE_INVALID")
	// P6 fix (no-side-effect assertion): tampered state must not persist tokens.
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// P4 fix (2026-07-16 code review Chunk 2, Auditor Major #2):
// Callback with state.CenterID != tc.CenterID — 403 OAUTH_STATE_MISMATCH.
// Constructs a signed state with a foreign CenterID (different uuid than
// the caller's session tc) and feeds it into the callback. Proves the
// double-binding check catches confused-deputy state substitution.
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_CenterIDMismatchReturns403(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackCenterMismatch")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Sign a state token whose CenterID is a different, valid-looking UUID
	// (not the caller's tc.CenterID) but UserID still matches the session.
	//nolint:gocritic // handler test — hard-coded but never persisted.
	otherCenterID := "99999999-9999-9999-9999-999999999999"
	userID := test.UUIDString(pgUID)
	mismatchState := test.SignMeet2_5CStateWithBinding(t, mockClk, otherCenterID, userID)

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=code&state="+mismatchState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "OAUTH_STATE_MISMATCH")
	// P5 fix parity: error message must be static (not echo the internal Reason).
	assertMeetErrorMessageIs(t, cbRec.Body.Bytes(), "OAuth state binding failed.")
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// P4 fix (2026-07-16 code review Chunk 2, Auditor Major #2):
// Callback with state.UserID != tc.UserID — 403 OAUTH_STATE_MISMATCH.
// Constructs a signed state whose UserID differs from the session user
// (state.CenterID still matches tc.CenterID to isolate the UserID-binding
// check independently of the CenterID-binding check).
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_UserIDMismatchReturns403(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackUserMismatch")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Same center, different user in the state payload.
	otherUserID := uuid.NewString()
	mismatchState := test.SignMeet2_5CStateWithBinding(t, mockClk, centerID, otherUserID)

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=code&state="+mismatchState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "OAUTH_STATE_MISMATCH")
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// P5 fix (2026-07-16 code review Chunk 2, Auditor Major #4):
// Callback with membership revoked between authorize and callback — 403
// OAUTH_MEMBERSHIP_REVOKED. Uses the WithRevokedMembership server variant
// that overrides authorizedByAccess to return false. Proves the
// spec-mandated AC5 step 3 fresh membership re-check surface at the
// handler layer (only the service test previously covered it).
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_MembershipRevokedReturns403(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackRevoked")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, stub := test.NewSettings2_5CTestServerWithRevokedMembership(t, db, pgUID, centerID, mockClk)

	// Prime state via authorize (this uses the ownerChain which the same
	// server exposes — membership override only applies inside HandleCallback).
	authReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	authRec := httptest.NewRecorder()
	srv.ServeHTTP(authRec, authReq)
	if authRec.Code != http.StatusOK {
		t.Fatalf("authorize prep: want 200, got %d", authRec.Code)
	}

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=code&state="+stub.LastState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusForbidden {
		t.Fatalf("want 403, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "OAUTH_MEMBERSHIP_REVOKED")
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// Callback code exchange fails — 502 INTEGRATION_CONNECT_FAILED envelope
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_ExchangeFailureReturns502(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackExchangeFail")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, stub := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Prime state.
	authReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	srv.ServeHTTP(httptest.NewRecorder(), authReq)
	stub.ExchangeErr = errors.New("invalid_grant")

	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=bad&state="+stub.LastState, nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusBadGateway {
		t.Fatalf("want 502, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	assertMeetErrorCode(t, cbRec.Body.Bytes(), "INTEGRATION_CONNECT_FAILED")
	// P6 fix (no-side-effect + Auditor Major #5): failed code exchange
	// must roll back the tx — no tokens persisted, flag not flipped.
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// Disconnect happy — 204 No Content
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Disconnect_HappyPathReturns204(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "DisconnectHappy")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	req := httptest.NewRequest(http.MethodDelete,
		"/api/centers/"+centerID+"/integrations/google-meet", nil)
	rec := httptest.NewRecorder()
	srv.ServeHTTP(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("want 204, got %d — body: %s", rec.Code, rec.Body.String())
	}
}

// -----------------------------------------------------------------------------
// Disconnect double — 204 (idempotent) — second call also succeeds
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Disconnect_DoubleReturns204(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "DisconnectDouble")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	for i := 0; i < 2; i++ {
		req := httptest.NewRequest(http.MethodDelete,
			"/api/centers/"+centerID+"/integrations/google-meet", nil)
		rec := httptest.NewRecorder()
		srv.ServeHTTP(rec, req)
		if rec.Code != http.StatusNoContent {
			t.Fatalf("call %d want 204, got %d — body: %s", i+1, rec.Code, rec.Body.String())
		}
	}
}

// -----------------------------------------------------------------------------
// D2 fix (2026-07-16 code review): Google `?error=access_denied` (user hit
// Cancel on the consent screen) must 302 to `?status=cancelled` instead of
// returning the misleading OAUTH_STATE_INVALID 400 envelope. Handler
// short-circuits before HandleCallback when the `error` query param is set.
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_GoogleErrorParamRedirectsToCancelled(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackCancel")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	srv, _ := test.NewSettings2_5CTestServerForUser(t, db, pgUID, centerID, mockClk)

	// Callback URL with `?error=access_denied` and NO `code` — Google's
	// exact shape when the user clicks Cancel on the consent screen.
	cbReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?error=access_denied&state=whatever", nil)
	cbRec := httptest.NewRecorder()
	srv.ServeHTTP(cbRec, cbReq)

	if cbRec.Code != http.StatusFound {
		t.Fatalf("want 302, got %d — body: %s", cbRec.Code, cbRec.Body.String())
	}
	loc := cbRec.Header().Get("Location")
	if !contains(loc, "tab=integrations") || !contains(loc, "status=cancelled") {
		t.Errorf("Location = %q, want tab=integrations&status=cancelled", loc)
	}
	// Must NOT contain status=connected.
	if contains(loc, "status=connected") {
		t.Errorf("Location wrongly includes status=connected: %q", loc)
	}
	// P8 fix (Edge #17): D2 cancel-flow must not have DB side-effects.
	// A regression that placed the redirect AFTER HandleCallback would
	// still emit the correct Location but also mutate DB — assert both.
	assertMeetHandlerNoSideEffect(t, db, centerID)
}

// -----------------------------------------------------------------------------
// Callback 429 — Retry-After header set + envelope carries request id
// -----------------------------------------------------------------------------
func TestGoogleMeetHandler_Callback_RateLimit429WithRetryAfter(t *testing.T) {
	db := test.SetupDB(t)
	pgUID, centerID := seedMeetOwnerHandler(t, db, "CallbackRateLimit")
	mockClk := clock.NewMockClock(time.Date(2026, 7, 16, 12, 0, 0, 0, time.UTC))
	// Rate-limited server: 1 req/min so the second call is deterministically denied.
	srv, stub := test.NewSettings2_5CTestServerRateLimited(t, db, pgUID, centerID, mockClk)

	// Prime state (this uses ownerChain, unaffected by callback bucket).
	authReq := httptest.NewRequest(http.MethodGet,
		"/api/centers/"+centerID+"/integrations/google-meet/authorize", nil)
	srv.ServeHTTP(httptest.NewRecorder(), authReq)

	// First callback consumes the token bucket (happy path → 302).
	cbReq1 := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=c&state="+stub.LastState, nil)
	cbRec1 := httptest.NewRecorder()
	srv.ServeHTTP(cbRec1, cbReq1)
	if cbRec1.Code != http.StatusFound {
		t.Fatalf("first callback want 302, got %d — body: %s", cbRec1.Code, cbRec1.Body.String())
	}

	// Second callback (rate-limited) must return 429 + Retry-After.
	cbReq2 := httptest.NewRequest(http.MethodGet,
		"/api/centers/callback/google-meet?code=c&state="+stub.LastState, nil)
	cbRec2 := httptest.NewRecorder()
	srv.ServeHTTP(cbRec2, cbReq2)
	if cbRec2.Code != http.StatusTooManyRequests {
		t.Fatalf("second callback want 429, got %d — body: %s", cbRec2.Code, cbRec2.Body.String())
	}
	retryAfter := cbRec2.Header().Get("Retry-After")
	if retryAfter == "" {
		t.Fatal("Retry-After header missing on 429")
	}
	if seconds, err := strconv.Atoi(retryAfter); err != nil || seconds <= 0 || seconds > 65 {
		t.Errorf("Retry-After = %q (parsed: %d), want [1, 65]", retryAfter, seconds)
	}
}

// -----------------------------------------------------------------------------
// assertion helpers
// -----------------------------------------------------------------------------

func assertMeetErrorCode(t *testing.T, body []byte, want string) {
	t.Helper()
	var env struct {
		Error struct {
			Code      string `json:"code"`
			Message   string `json:"message"`
			RequestID string `json:"requestId"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode error envelope: %v — body: %s", err, string(body))
	}
	if env.Error.Code != want {
		t.Errorf("error.code = %q, want %q — body: %s", env.Error.Code, want, string(body))
	}
	if env.Error.Message == "" {
		t.Errorf("error.message empty")
	}
	// requestId can be empty in tests (no RequestID middleware) — don't assert.
}

// assertMeetErrorMessageIs verifies the error envelope's `message` field is
// exactly `want`. Used by the OAUTH_STATE_MISMATCH tests to prove the P5
// static-message fix — the internal Reason field must NOT leak to clients.
// P4/P5 fix helper (Round 1 code review Chunk 2, 2026-07-16).
func assertMeetErrorMessageIs(t *testing.T, body []byte, want string) {
	t.Helper()
	var env struct {
		Error struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(body, &env); err != nil {
		t.Fatalf("decode error envelope: %v — body: %s", err, string(body))
	}
	if env.Error.Message != want {
		t.Errorf("error.message = %q, want %q", env.Error.Message, want)
	}
}

// assertMeetHandlerNoSideEffect asserts that no center_integrations row was
// persisted and centers.google_meet_connected is still false. P6/P8 fix
// helper — every handler-layer error-branch test should call this after
// the HTTP assertion to prove tx rollback / early-return did not leak
// partial state. Requires the caller to have used seedMeetOwnerHandler
// (which seeds an Owner + center via CenterService, leaving flag=false).
func assertMeetHandlerNoSideEffect(t *testing.T, db *test.TxDB, centerID string) {
	t.Helper()
	centerUUID, err := uuid.Parse(centerID)
	if err != nil {
		t.Fatalf("parse centerID: %v", err)
	}
	// Flag stays false.
	var flag bool
	if err := db.QueryRow(context.Background(),
		"SELECT google_meet_connected FROM centers WHERE id = $1", centerUUID,
	).Scan(&flag); err != nil {
		t.Fatalf("query google_meet_connected: %v", err)
	}
	if flag {
		t.Error("side-effect: centers.google_meet_connected flipped to true on error branch")
	}
	// No integration row.
	test.TenantContext(t, db, pgtype.UUID{Bytes: centerUUID, Valid: true})
	var count int
	if err := db.QueryRow(context.Background(),
		"SELECT count(*) FROM center_integrations WHERE center_id = $1 AND provider = 'google_meet'",
		centerUUID,
	).Scan(&count); err != nil {
		t.Fatalf("query center_integrations: %v", err)
	}
	if count != 0 {
		t.Errorf("side-effect: %d center_integrations rows persisted on error branch, want 0", count)
	}
}

func contains(haystack, needle string) bool {
	for i := 0; i+len(needle) <= len(haystack); i++ {
		if haystack[i:i+len(needle)] == needle {
			return true
		}
	}
	return false
}
