// google_oauth_handler_atdd_test.go — Story 1.6 integration tests for
// the Google OAuth HTTP layer (init + callback).
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-01  GET /api/auth/google → 302 to Google + oauth_state cookie set
//   AC-1.6-02  Callback redirect targets: happy → APP_POST_LOGIN_URL; csrf/exchange/etc → APP_LOGIN_ERROR_URL_BASE?error=<code>
//   AC-1.6-08  oauth_state cookie carries HttpOnly + Secure + SameSite=Lax + Domain (non-dev), Path=/api/auth, Max-Age=600
//   AC-1.6-02  Successful callback clears the oauth_state cookie (replay defense)
//
// RISK MAP
//   R7 (score 6) — cookie attrs MUST hold in non-dev or session integrity breaks

package handler_test

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/handler"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/ducdo/classlite-api/internal/test"
	"golang.org/x/oauth2"
)

// mockGoogleOAuthClient is a test stub for service.GoogleOAuthClient.
type mockGoogleOAuthClient struct {
	authURLBase string
	userInfo    *service.GoogleUserInfo
	exchangeErr error
	userInfoErr error
}

func (m *mockGoogleOAuthClient) AuthCodeURL(state string) string {
	if m.authURLBase == "" {
		m.authURLBase = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test"
	}
	return m.authURLBase + "&state=" + state
}

func (m *mockGoogleOAuthClient) Exchange(ctx context.Context, code string) (*oauth2.Token, error) {
	if m.exchangeErr != nil {
		return nil, m.exchangeErr
	}
	return &oauth2.Token{AccessToken: "fake-token"}, nil
}

func (m *mockGoogleOAuthClient) UserInfo(ctx context.Context, token *oauth2.Token) (*service.GoogleUserInfo, error) {
	if m.userInfoErr != nil {
		return nil, m.userInfoErr
	}
	return m.userInfo, nil
}

// newGoogleHandlerHarness builds a non-dev-flavored handler (Secure cookie,
// Domain set) so the AC8 attribute assertions don't fight the dev defaults.
func newGoogleHandlerHarness(t *testing.T, mockClock *clock.MockClock, oauthClient service.GoogleOAuthClient, nonDev bool) (*handler.AuthHandler, *test.TxDB) {
	t.Helper()
	db := test.SetupDB(t)
	hasher := service.BcryptHasher{Cost: 4}
	sender := &service.MockEmailSender{}
	queue := service.NewEmailRetryQueue(sender, 8)
	auditLogger := service.NewPgAuthAuditLogger(db)
	svc := service.NewAuthServiceWithClock(db, hasher, sender, auditLogger, queue, "http://localhost/verify", mockClock)
	svc.SetJWTSigner(service.NewJWTSignerWithClock([]byte("test-signing-key-at-least-256-bits-long-12345678"), mockClock))
	const stateSecret = "test-oauth-state-secret-32-bytes!"
	svc.SetGoogleOAuth(oauthClient, service.NewOAuthStateSignerWithClock([]byte(stateSecret), mockClock))
	svc.SetAppApexHost("my.classlite.app")
	svc.SetAppPostLoginURL("http://localhost:5173/")
	svc.SetAppLoginErrorURLBase("http://localhost:5173/login")

	cookieCfg := handler.CookieConfig{Domain: "", Secure: false, SameSite: http.SameSiteLaxMode}
	if nonDev {
		cookieCfg = handler.CookieConfig{Domain: ".classlite.app", Secure: true, SameSite: http.SameSiteLaxMode}
	}
	return handler.NewAuthHandler(svc, cookieCfg), db
}

// TestGoogleInit_AC01_HTTP_RedirectsToGoogleWithStateCookie proves the
// 302 + cookie shape.
func TestGoogleInit_AC01_HTTP_RedirectsToGoogleWithStateCookie(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google", nil)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, "https://accounts.google.com/") {
		t.Errorf("Location: want Google URL, got %q", loc)
	}
	if !strings.Contains(loc, "state=") {
		t.Errorf("Location should contain state= param, got %q", loc)
	}

	// Find the oauth_state cookie in the raw header (not via
	// rec.Result().Cookies() because that round-trip would strip
	// leading-dot Domain, defeating the AC8 dot-Domain test).
	setCookies := rec.Header().Values("Set-Cookie")
	var stateHeader string
	for _, h := range setCookies {
		if strings.HasPrefix(h, "oauth_state=") {
			stateHeader = h
			break
		}
	}
	if stateHeader == "" {
		t.Fatalf("missing oauth_state Set-Cookie header (got %v)", setCookies)
	}
	if !strings.Contains(stateHeader, "; HttpOnly") {
		t.Error("oauth_state cookie missing HttpOnly")
	}
}

// TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes asserts the
// six-attribute invariant on the non-dev Set-Cookie header.
func TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, true)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google", nil)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	setCookies := rec.Header().Values("Set-Cookie")
	var stateHeader string
	for _, h := range setCookies {
		if strings.HasPrefix(h, "oauth_state=") {
			stateHeader = h
			break
		}
	}
	if stateHeader == "" {
		t.Fatalf("missing oauth_state Set-Cookie header (got %v)", setCookies)
	}

	required := []string{
		"oauth_state=",
		"; Path=/api/auth",
		"; Domain=.classlite.app",
		"; HttpOnly",
		"; Secure",
		"; SameSite=Lax",
		"; Max-Age=600",
	}
	for _, want := range required {
		if !strings.Contains(stateHeader, want) {
			t.Errorf("oauth_state cookie missing %q (header=%q)", want, stateHeader)
		}
	}
}

// TestGoogleInit_AC01_UnknownInvite_Returns404 proves the inline 404
// envelope.
func TestGoogleInit_AC01_UnknownInvite_Returns404(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	req := httptest.NewRequest(http.MethodGet, "/api/auth/google?inviteToken=definitely-bogus", nil)
	rec := httptest.NewRecorder()
	h.GoogleInit(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("status: want 404, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "INVITE_NOT_FOUND") {
		t.Errorf("body should mention INVITE_NOT_FOUND, got %q", rec.Body.String())
	}
}

// TestGoogleCallback_AC02_GoogleAccessDenied_RedirectsWithFriendlyError
// proves the user-cancellation surface.
func TestGoogleCallback_AC02_GoogleAccessDenied_RedirectsWithFriendlyError(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?error=access_denied&state=anything", nil)
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=google_access_denied") {
		t.Errorf("Location should contain error=google_access_denied, got %q", loc)
	}
}

// TestGoogleCallback_AC02_StateMissing_RedirectsWithCsrfError proves
// the missing-cookie surface.
func TestGoogleCallback_AC02_StateMissing_RedirectsWithCsrfError(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	h, _ := newGoogleHandlerHarness(t, mockClock, &mockGoogleOAuthClient{}, false)

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?code=x&state=y", nil)
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302, got %d", rec.Code)
	}
	loc := rec.Header().Get("Location")
	if !strings.Contains(loc, "error=csrf_invalid") {
		t.Errorf("Location should contain error=csrf_invalid, got %q", loc)
	}
}

// TestGoogleCallback_AC02_HappyPath_RedirectsToPostLoginURL proves a
// successful callback emits 302 → APP_POST_LOGIN_URL, sets the
// refresh_token cookie, and clears the oauth_state cookie.
func TestGoogleCallback_AC02_HappyPath_RedirectsToPostLoginURL(t *testing.T) {
	mockClock := clock.NewMockClock(time.Date(2026, 7, 1, 12, 0, 0, 0, time.UTC))
	oauthMock := &mockGoogleOAuthClient{
		userInfo: &service.GoogleUserInfo{
			Sub:           "google-sub-handler-happy",
			Email:         "handler-happy@example.com",
			EmailVerified: true,
			Name:          "Handler Happy",
		},
	}
	h, _ := newGoogleHandlerHarness(t, mockClock, oauthMock, false)

	// Sign a fresh state token the way GoogleInit would.
	const stateSecret = "test-oauth-state-secret-32-bytes!"
	signer := service.NewOAuthStateSignerWithClock([]byte(stateSecret), mockClock)
	state, err := signer.Sign(service.OAuthStatePayload{
		Nonce:    "happy-nonce",
		IssuedAt: mockClock.Now().Unix(),
	})
	if err != nil {
		t.Fatalf("sign state: %v", err)
	}

	req := httptest.NewRequest(http.MethodGet,
		"/api/auth/google/callback?code=code&state="+state, nil)
	req.AddCookie(&http.Cookie{Name: "oauth_state", Value: state})
	req.Host = "my.classlite.app" // apex — skip tenant binding
	rec := httptest.NewRecorder()
	h.GoogleCallback(rec, req)

	if rec.Code != http.StatusFound {
		t.Fatalf("status: want 302, got %d (body=%q)", rec.Code, rec.Body.String())
	}
	loc := rec.Header().Get("Location")
	if !strings.HasPrefix(loc, "http://localhost:5173/") {
		t.Errorf("Location: want app-post-login URL, got %q", loc)
	}

	setCookies := rec.Header().Values("Set-Cookie")
	var sawRefresh, sawClear bool
	for _, c := range setCookies {
		if strings.HasPrefix(c, "refresh_token=") && !strings.Contains(c, "Max-Age=0") {
			sawRefresh = true
		}
		if strings.HasPrefix(c, "oauth_state=") && strings.Contains(c, "Max-Age=0") {
			sawClear = true
		}
	}
	if !sawRefresh {
		t.Errorf("expected refresh_token cookie set on happy callback, headers=%v", setCookies)
	}
	if !sawClear {
		t.Errorf("expected oauth_state cookie cleared on happy callback, headers=%v", setCookies)
	}
}
