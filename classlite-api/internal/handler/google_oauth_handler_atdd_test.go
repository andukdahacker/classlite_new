//go:build atdd_red_phase

// google_oauth_handler_atdd_test.go — Story 1.6 ATDD red-phase
// scaffolds for the Google OAuth HTTP layer (init + callback).
//
// ACCEPTANCE CRITERIA COVERED
//   AC-1.6-01  GET /api/auth/google → 302 to Google + oauth_state cookie set
//   AC-1.6-02  Callback redirect targets — happy → APP_POST_LOGIN_URL; csrf/exchange/etc → APP_LOGIN_ERROR_URL_BASE?error=<code>
//   AC-1.6-08  oauth_state cookie carries HttpOnly + Secure + SameSite=Lax + Domain (non-dev), Path=/api/auth, Max-Age=600
//   AC-1.6-02  Successful callback clears the oauth_state cookie (replay defense)
//
// RISK MAP
//   R7 (score 6) — cookie attrs MUST hold in non-dev or session integrity breaks

package handler_test

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestGoogleInit_AC01_HTTP_RedirectsToGoogleWithStateCookie proves the
// init endpoint sets the oauth_state cookie AND issues a 302 with the
// signed state echoed in the Google URL's state= query param.
func TestGoogleInit_AC01_HTTP_RedirectsToGoogleWithStateCookie(t *testing.T) {
	t.Skip("ATDD red phase — implement handler.AuthHandler.GoogleInit then remove this skip")

	// Test harness will look something like:
	//
	//   svc := newAuthHandlerWithOAuth(t, &mockGoogleOAuthClient{...}, nonDevCookieConfig)
	//   req := httptest.NewRequest("GET", "/api/auth/google", nil)
	//   rec := httptest.NewRecorder()
	//   svc.GoogleInit(rec, req)
	//
	//   if rec.Code != http.StatusFound { t.Fatalf(...) }
	//   loc := rec.Header().Get("Location")
	//   if !strings.HasPrefix(loc, "https://accounts.google.com/o/oauth2/v2/auth?") { ... }
	//   if !strings.Contains(loc, "state=") { ... }
	//   cookies := rec.Result().Cookies()
	//   var stateCookie *http.Cookie
	//   for _, c := range cookies { if c.Name == "oauth_state" { stateCookie = c } }
	//   if stateCookie == nil { t.Fatal("missing oauth_state cookie") }
	//   // — the AC08 attribute assertions live in the next test
	_ = httptest.NewRequest
	_ = strings.HasPrefix
}

// TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes proves that
// in non-dev (cookie.Secure=true, cookie.Domain non-empty), the
// emitted Set-Cookie header carries HttpOnly + Secure + SameSite=Lax
// + Domain + Path=/api/auth + Max-Age=600.
//
// We parse the raw Set-Cookie header (not just rec.Result().Cookies())
// because Go's stdlib stripping of leading-dot Domain values is the
// exact gap Story 1.5 caught — and Story 1.6 inherits the same
// buildCookieHeader helper to preserve the dot.
func TestGoogleInit_AC08_NonDev_CookieCarriesAllAttributes(t *testing.T) {
	t.Skip("ATDD red phase — implement handler.AuthHandler.GoogleInit with buildCookieHeader so the dot Domain survives, then remove this skip")

	// Expected raw Set-Cookie header contains, in any order:
	//   "oauth_state=<value>"
	//   "; Path=/api/auth"
	//   "; Domain=.classlite.app"
	//   "; HttpOnly"
	//   "; Secure"
	//   "; SameSite=Lax"
	//   "; Max-Age=600"
	required := []string{
		"oauth_state=",
		"; Path=/api/auth",
		"; Domain=.classlite.app",
		"; HttpOnly",
		"; Secure",
		"; SameSite=Lax",
		"; Max-Age=600",
	}
	_ = required
}

// TestGoogleInit_AC01_UnknownInvite_Returns404 proves that init
// validates the invite token (if supplied) before redirecting to
// Google. A 404 inline is better UX than letting the user round-trip
// to Google only to discover the invite is dead.
func TestGoogleInit_AC01_UnknownInvite_Returns404(t *testing.T) {
	t.Skip("ATDD red phase — implement handler.AuthHandler.GoogleInit with InviteNotFoundError → 404 JSON envelope")

	// req := httptest.NewRequest("GET", "/api/auth/google?inviteToken=bogus", nil)
	// ...
	// assert rec.Code == 404
	// assert body contains "INVITE_NOT_FOUND"
}

// TestGoogleCallback_AC02_HappyPath_RedirectsToPostLoginURL proves the
// callback emits 302 → APP_POST_LOGIN_URL on success, sets the
// refresh_token cookie, AND clears the oauth_state cookie (Max-Age=0).
func TestGoogleCallback_AC02_HappyPath_RedirectsToPostLoginURL(t *testing.T) {
	t.Skip("ATDD red phase — implement handler.AuthHandler.GoogleCallback wired to a mock GoogleOAuthClient returning a happy profile")

	// Expected:
	//   rec.Code == 302
	//   Location == "http://localhost:5173/" (or APP_POST_LOGIN_URL)
	//   Set-Cookie refresh_token=<value>; ... (per AC10 from Story 1.5)
	//   Set-Cookie oauth_state=; Max-Age=0; ... (clearing cookie)
}

// TestGoogleCallback_AC02_StateMissing_RedirectsWithCsrfError proves
// the cookie-absent path: a callback whose browser has no
// oauth_state cookie (cookies disabled, expired, or never set) gets
// redirected to ${LOGIN_URL}?error=csrf_invalid.
func TestGoogleCallback_AC02_StateMissing_RedirectsWithCsrfError(t *testing.T) {
	t.Skip("ATDD red phase — implement handler.AuthHandler.GoogleCallback cookie-absent branch")

	// req := httptest.NewRequest("GET", "/api/auth/google/callback?code=x&state=y", nil)
	// (no oauth_state cookie attached)
	// ...
	// assert rec.Code == 302
	// assert Location contains "?error=csrf_invalid"
}

// TestGoogleCallback_AC02_GoogleAccessDenied_RedirectsWithFriendlyError
// proves the user-cancellation path: Google returns ?error=access_denied
// → callback writes 302 LOGIN_URL?error=google_access_denied without
// emitting an audit row (it's normal user behavior).
func TestGoogleCallback_AC02_GoogleAccessDenied_RedirectsWithFriendlyError(t *testing.T) {
	t.Skip("ATDD red phase — implement Google upstream error mapping")

	// req := httptest.NewRequest("GET",
	//   "/api/auth/google/callback?error=access_denied&state=anything", nil)
	// ...
	// assert rec.Code == 302
	// assert Location contains "?error=google_access_denied"
	// assert audit_logs has NO row for this attempt
}

// TestGoogleCallback_AC02_InviteEmailMismatch_LoginSucceedsWithErrorParam
// proves AC5's UX contract: even when the invite gets rejected (email
// mismatch), the user is signed in (Google identity is valid) and
// redirected with ?error=invite_email_mismatch. The frontend can
// then show a banner explaining the mismatch.
func TestGoogleCallback_AC02_InviteEmailMismatch_LoginSucceedsWithErrorParam(t *testing.T) {
	t.Skip("ATDD red phase — implement invite-mismatch surface in callback handler")

	// Expected:
	//   rec.Code == 302
	//   Location starts with APP_POST_LOGIN_URL (login succeeded)
	//   Location contains "?error=invite_email_mismatch"
	//   Location contains "&expectedEmail=" (url-encoded invite email)
	//   Location contains "&googleEmail="   (url-encoded oauth email)
	//   refresh_token cookie IS set (login succeeded)
	//   oauth_state cookie cleared
}

// (Helpers stubbed; flesh out alongside dev implementation.)
//
// Sample non-dev cookie config to use in the assertions above:
//
//   func nonDevCookieConfig() handler.CookieConfig {
//     return handler.CookieConfig{
//       Domain:   ".classlite.app",
//       Secure:   true,
//       SameSite: http.SameSiteLaxMode,
//     }
//   }

func init() {
	_ = http.SameSiteLaxMode
}
