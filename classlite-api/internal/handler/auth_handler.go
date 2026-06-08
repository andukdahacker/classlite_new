// Package handler — auth handlers for stories 1.4, 1.5, 1.6.
package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"

	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service"
	"github.com/google/uuid"
)

// maxAuthRequestBodyBytes caps every auth endpoint body to 16 KiB. The handful
// of fields these endpoints accept fit in far less, so any payload approaching
// this limit is either malformed or hostile. Cap exists to prevent unbounded
// io.ReadAll / json.Decode allocation from OOMing the process.
const maxAuthRequestBodyBytes = 16 * 1024

// Story 1.6 cookie constants. TTL is derived from the service-layer
// OAuthStateTTL so a change in one place propagates everywhere.
const (
	oauthStateCookieName = "oauth_state"
	oauthStateCookiePath = "/api/auth"
)

var oauthStateCookieTTL = int(service.OAuthStateTTL.Seconds())

// CookieConfig drives the attributes the AuthHandler sets on Set-Cookie
// responses. Production (APP_ENV != "development") MUST set all three to
// non-zero / non-empty values. Dev mode uses an empty Domain and Secure=false
// so the local Vite proxy works without HTTPS.
type CookieConfig struct {
	Domain   string
	Secure   bool
	SameSite http.SameSite
}

// AuthHandler wraps AuthService for HTTP routing.
type AuthHandler struct {
	svc    *service.AuthService
	cookie CookieConfig
}

// NewAuthHandler constructs an AuthHandler with the given service + cookie
// config. Story 1.4 callsites (e.g. main.go's previous struct literal
// `&handler.AuthHandler{Svc: ...}`) MUST switch to this constructor.
//
// Panics on SameSiteDefaultMode because a Set-Cookie emitted without an
// explicit SameSite attribute silently downgrades AC10's cookie contract
// — easier to surface as a boot panic than as a runtime security gap.
func NewAuthHandler(svc *service.AuthService, cookie CookieConfig) *AuthHandler {
	if cookie.SameSite == http.SameSiteDefaultMode {
		panic("auth handler: CookieConfig.SameSite must be set explicitly (Lax / Strict / None)")
	}
	return &AuthHandler{svc: svc, cookie: cookie}
}

// Svc exposes the underlying service for tests that still need it (e.g.
// when seeding state with svc.SetPassword before exercising the handler).
func (h *AuthHandler) Svc() *service.AuthService { return h.svc }

// decodeAuthBody applies the shared 16 KiB body cap and decodes JSON into dst.
// A nil error means the body parsed cleanly; any error is mapped to a 422
// ValidationError by the caller (oversize bodies, malformed JSON, and read
// errors all collapse to the same user-facing response).
func decodeAuthBody(w http.ResponseWriter, r *http.Request, dst any) error {
	r.Body = http.MaxBytesReader(w, r.Body, maxAuthRequestBodyBytes)
	return json.NewDecoder(r.Body).Decode(dst)
}

// Request DTOs — camelCase JSON tags per architecture format convention.
type registerRequestBody struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"fullName"`
}

type verifyEmailRequestBody struct {
	Token string `json:"token"`
}

type resendVerificationRequestBody struct {
	Email string `json:"email"`
}

type loginRequestBody struct {
	Email      string `json:"email"`
	Password   string `json:"password"`
	RememberMe bool   `json:"rememberMe"`
}

type forgotPasswordRequestBody struct {
	Email string `json:"email"`
}

type resetPasswordRequestBody struct {
	Token       string `json:"token"`
	NewPassword string `json:"newPassword"`
}

// Story 1.6 — invite acceptance.
type acceptInviteRequestBody struct {
	InviteToken string `json:"inviteToken"`
	FullName    string `json:"fullName"`
	Password    string `json:"password"`
}

type acceptInviteCenterPayload struct {
	ID   string `json:"id"`
	Name string `json:"name"`
}

type acceptInviteResponseBody struct {
	AccessToken string                    `json:"accessToken"`
	User        userSummary               `json:"user"`
	Center      acceptInviteCenterPayload `json:"center"`
	Role        string                    `json:"role"`
}

// Response DTOs — GO-5: never use omitempty.
type registerResponseUser struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	FullName      string `json:"fullName"`
	EmailVerified bool   `json:"emailVerified"`
}

type registerResponseBody struct {
	User          registerResponseUser `json:"user"`
	VerifyPollID  string               `json:"verifyPollId"`
	EmailDelivery string               `json:"emailDelivery"`
}

type verifyEmailResponseBody struct {
	Verified bool   `json:"verified"`
	Email    string `json:"email"`
}

type resendResponseBody struct {
	// Pointer so JSON encodes null when there is no pollId (ambiguous response, AC7).
	VerifyPollID *string `json:"verifyPollId"`
}

type verifyStatusResponseBody struct {
	Verified bool   `json:"verified"`
	Email    string `json:"email"`
}

type userSummary struct {
	ID            string `json:"id"`
	Email         string `json:"email"`
	FullName      string `json:"fullName"`
	EmailVerified bool   `json:"emailVerified"`
}

type loginResponseBody struct {
	AccessToken string      `json:"accessToken"`
	User        userSummary `json:"user"`
}

type logoutResponseBody struct {
	LoggedOut bool `json:"loggedOut"`
}

type forgotPasswordResponseBody struct {
	Sent bool `json:"sent"`
}

type resetPasswordResponseBody struct {
	Reset bool `json:"reset"`
}

// Register implements POST /api/auth/register (AC1, AC2, AC11, AC12).
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) error {
	var req registerRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.svc.Register(r.Context(), service.RegisterRequest{
		Email:    req.Email,
		Password: req.Password,
		FullName: req.FullName,
	})
	if err != nil {
		return err
	}

	WriteJSON(w, http.StatusCreated, registerResponseBody{
		User: registerResponseUser{
			ID:            uuid.UUID(res.User.ID.Bytes).String(),
			Email:         res.User.Email,
			FullName:      res.User.FullName,
			EmailVerified: res.User.EmailVerified,
		},
		VerifyPollID:  res.VerifyPollID.String(),
		EmailDelivery: res.EmailDelivery,
	})
	return nil
}

// VerifyEmail implements POST /api/auth/verify-email (AC3, AC4, AC5, AC6).
func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) error {
	var req verifyEmailRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.svc.VerifyEmail(r.Context(), req.Token)
	if err != nil {
		return err
	}

	WriteJSON(w, http.StatusOK, verifyEmailResponseBody{
		Verified: res.Verified,
		Email:    res.Email,
	})
	return nil
}

// ResendVerification implements POST /api/auth/resend-verification (AC7, H4).
func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) error {
	var req resendVerificationRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}

	res, err := h.svc.ResendVerification(r.Context(), req.Email)
	if err != nil {
		return err
	}

	body := resendResponseBody{}
	if res.VerifyPollID != nil {
		s := res.VerifyPollID.String()
		body.VerifyPollID = &s
	}
	WriteJSON(w, http.StatusOK, body)
	return nil
}

// VerifyStatus implements GET /api/auth/verify-status?pollId=<uuid> (AC8).
func (h *AuthHandler) VerifyStatus(w http.ResponseWriter, r *http.Request) error {
	raw := r.URL.Query().Get("pollId")
	if raw == "" {
		return model.NotFoundError{Resource: "verify_poll", Code: "POLL_ID_NOT_FOUND"}
	}
	pollID, err := uuid.Parse(raw)
	if err != nil {
		// Malformed UUID — same 404 as unknown, per AC8 second clause.
		return model.NotFoundError{Resource: "verify_poll", Code: "POLL_ID_NOT_FOUND"}
	}

	res, err := h.svc.VerifyStatus(r.Context(), pollID)
	if err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, verifyStatusResponseBody{
		Verified: res.Verified,
		Email:    res.Email,
	})
	return nil
}

// Login implements POST /api/auth/login (AC1, AC6, AC7, AC10).
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) error {
	var req loginRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	res, err := h.svc.Login(r.Context(), service.LoginInput{
		Email:      req.Email,
		Password:   req.Password,
		RememberMe: req.RememberMe,
	})
	if err != nil {
		return err
	}
	h.setRefreshCookie(w, res)
	WriteJSON(w, http.StatusOK, loginResponseBody{
		AccessToken: res.AccessToken,
		User: userSummary{
			ID:            uuid.UUID(res.User.ID.Bytes).String(),
			Email:         res.User.Email,
			FullName:      res.User.FullName,
			EmailVerified: res.User.EmailVerified,
		},
	})
	return nil
}

// Refresh implements POST /api/auth/refresh (AC2, AC8, AC9).
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) error {
	cookie, err := r.Cookie("refresh_token")
	if err != nil || cookie.Value == "" {
		return &service.RefreshTokenInvalidError{}
	}
	res, err := h.svc.RefreshTokens(r.Context(), cookie.Value)
	if err != nil {
		return err
	}
	h.setRefreshCookie(w, res)
	WriteJSON(w, http.StatusOK, loginResponseBody{
		AccessToken: res.AccessToken,
		User: userSummary{
			ID:            uuid.UUID(res.User.ID.Bytes).String(),
			Email:         res.User.Email,
			FullName:      res.User.FullName,
			EmailVerified: res.User.EmailVerified,
		},
	})
	return nil
}

// Logout implements POST /api/auth/logout (AC5). The clearing cookie is
// always emitted (whether the service succeeds, fails, or finds no row);
// service failures still propagate so the client learns that the
// server-side state was NOT actually mutated.
func (h *AuthHandler) Logout(w http.ResponseWriter, r *http.Request) error {
	var raw string
	if cookie, err := r.Cookie("refresh_token"); err == nil {
		raw = cookie.Value
	}
	// Set the clearing cookie BEFORE we know the svc outcome. Set-Cookie
	// lives in the response headers — emitting it now means even an error
	// path (handled by ErrorMapper) still tells the browser to discard.
	h.clearRefreshCookie(w)
	if err := h.svc.Logout(r.Context(), raw); err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, logoutResponseBody{LoggedOut: true})
	return nil
}

// ForgotPassword implements POST /api/auth/forgot-password (AC3).
func (h *AuthHandler) ForgotPassword(w http.ResponseWriter, r *http.Request) error {
	var req forgotPasswordRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if err := h.svc.RequestPasswordReset(r.Context(), req.Email); err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, forgotPasswordResponseBody{Sent: true})
	return nil
}

// ResetPassword implements POST /api/auth/reset-password (AC4).
func (h *AuthHandler) ResetPassword(w http.ResponseWriter, r *http.Request) error {
	var req resetPasswordRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	if err := h.svc.ResetPassword(r.Context(), req.Token, req.NewPassword); err != nil {
		return err
	}
	WriteJSON(w, http.StatusOK, resetPasswordResponseBody{Reset: true})
	return nil
}

// setRefreshCookie emits the refresh-token Set-Cookie with all four
// attributes from h.cookie. Max-Age is derived from the service-declared
// RefreshTTL (not wall-clock arithmetic on RefreshExpiresAt), so MockClock
// in tests doesn't observe a near-zero Max-Age.
//
// Why we write the header manually instead of using http.SetCookie: stdlib
// SetCookie strips the leading dot from Domain values per RFC 6265 §5.2.3
// (the dot is informational; user agents discard it). The ATDD AC10
// assertion requires the dot to survive round-trip parsing, and writing
// the header by hand is the only way to achieve that.
func (h *AuthHandler) setRefreshCookie(w http.ResponseWriter, r *service.LoginResult) {
	maxAge := int(r.RefreshTTL.Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	header, err := buildCookieHeader("refresh_token", r.RefreshToken, h.cookie, maxAge)
	if err != nil {
		// This indicates a programming bug — service-generated refresh
		// tokens contain only base64url+hex chars, so the sanitization
		// reject should never fire. Surface it loudly via slog rather
		// than silently emit a malformed cookie.
		WriteError(w, nil, http.StatusInternalServerError, "INTERNAL_ERROR", "An unexpected error occurred.", nil)
		return
	}
	w.Header().Add("Set-Cookie", header)
}

// clearRefreshCookie emits a Set-Cookie with MaxAge=-1 and zero value so
// browsers discard the existing refresh_token cookie regardless of
// previous attributes.
func (h *AuthHandler) clearRefreshCookie(w http.ResponseWriter) {
	header, err := buildCookieHeader("refresh_token", "", h.cookie, -1)
	if err != nil {
		// Empty value always passes sanitization; surface defensively.
		return
	}
	w.Header().Add("Set-Cookie", header)
}

// ---------------------------------------------------------------------
// Story 1.6 — Google OAuth + invite-acceptance handlers.
// ---------------------------------------------------------------------

// GoogleInit implements GET /api/auth/google (AC1). The handler is the
// plain func(w, r) shape — not the error-returning one — because the
// success path emits a 302 to Google, not a JSON envelope. The single
// JSON failure case (InviteNotFoundError) is written inline.
func (h *AuthHandler) GoogleInit(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	inviteToken := strings.TrimSpace(q.Get("inviteToken"))
	redirectTo := strings.TrimSpace(q.Get("redirectTo"))

	// Defensive caps so a malicious caller can't push gigabytes through
	// the query string. The service also enforces these, but rejecting at
	// the edge keeps a confused log line out of the service layer.
	if len(inviteToken) > service.MaxInviteTokenChars {
		WriteError(w, r, http.StatusBadRequest, "INVALID_INVITE_TOKEN", "Invite token is malformed.", nil)
		return
	}
	if len(redirectTo) > service.MaxRedirectToChars {
		redirectTo = "" // silently drop
	}

	result, err := h.svc.InitiateGoogleOAuth(r.Context(), service.InitiateGoogleOAuthInput{
		InviteToken: inviteToken,
		RedirectTo:  redirectTo,
	})
	if err != nil {
		// Pre-Google failure: inline JSON envelope so the SPA can render
		// the error without round-tripping through the login screen.
		var inviteNotFound *service.InviteNotFoundError
		var inviteExpired *service.InviteExpiredError
		var inviteAlreadyAccepted *service.InviteAlreadyAcceptedError
		var notConfigured *service.OAuthNotConfiguredError
		switch {
		case errors.As(err, &inviteNotFound):
			WriteError(w, r, http.StatusNotFound,
				"INVITE_NOT_FOUND", "This invite link is no longer valid.", nil)
		case errors.As(err, &inviteExpired):
			WriteError(w, r, http.StatusGone,
				"INVITE_EXPIRED", "This invite link has expired.",
				map[string]any{"centerName": inviteExpired.CenterName, "inviterEmail": inviteExpired.InviterEmail})
		case errors.As(err, &inviteAlreadyAccepted):
			WriteError(w, r, http.StatusConflict,
				"INVITE_ALREADY_ACCEPTED", "This invite has already been accepted.",
				map[string]any{"centerName": inviteAlreadyAccepted.CenterName})
		case errors.As(err, &notConfigured):
			WriteError(w, r, http.StatusServiceUnavailable,
				"OAUTH_NOT_CONFIGURED", "Google sign-in is not configured.", nil)
		default:
			slog.Error("oauth init failed", "error", err)
			WriteError(w, r, http.StatusInternalServerError,
				"INTERNAL_ERROR", "An unexpected error occurred.", nil)
		}
		return
	}

	header, err := buildOAuthStateCookieHeader(result.SignedState, h.cookie, oauthStateCookieTTL)
	if err != nil {
		slog.Error("oauth state cookie build failed", "error", err)
		WriteError(w, r, http.StatusInternalServerError,
			"INTERNAL_ERROR", "An unexpected error occurred.", nil)
		return
	}
	w.Header().Add("Set-Cookie", header)
	http.Redirect(w, r, result.AuthCodeURL, http.StatusFound)
}

// GoogleCallback implements GET /api/auth/google/callback (AC2). Errors
// map to 302 redirects to APP_LOGIN_ERROR_URL_BASE with ?error=<code>
// rather than JSON envelopes — the user landed here via a browser
// navigation, so an envelope would be hostile UX.
func (h *AuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request) {
	q := r.URL.Query()
	code := q.Get("code")
	state := q.Get("state")
	upstreamErr := q.Get("error")

	// IMPORTANT: clearOAuthStateCookie MUST be called BEFORE every
	// http.Redirect — Go's net/http server commits response headers when
	// http.Redirect calls WriteHeader+Write. A deferred clear runs after
	// headers are committed and never reaches the wire. Hoisting the
	// clear into each exit branch is the only way the replay defense
	// actually works in production.

	// User-cancellation surface: no audit row (it's normal behavior).
	if upstreamErr == "access_denied" {
		h.clearOAuthStateCookie(w)
		http.Redirect(w, r, h.errorRedirect("google_access_denied"), http.StatusFound)
		return
	}
	if upstreamErr != "" {
		slog.Warn("google oauth callback upstream error",
			"event", "oauth_upstream_error",
			"upstream_error", upstreamErr)
		h.clearOAuthStateCookie(w)
		http.Redirect(w, r, h.errorRedirect("google_server_error"), http.StatusFound)
		return
	}

	// Cookie present.
	cookie, _ := r.Cookie(oauthStateCookieName)
	cookieValue := ""
	if cookie != nil {
		cookieValue = cookie.Value
	}

	result, err := h.svc.HandleGoogleCallback(r.Context(), service.GoogleCallbackInput{
		Code:        code,
		State:       state,
		CookieState: cookieValue,
		RequestHost: r.Host,
	})
	if err != nil {
		// OAuthNotConfiguredError is operator misconfiguration — surface
		// as a 503 envelope (no redirect), so monitoring picks it up.
		var notConfigured *service.OAuthNotConfiguredError
		if errors.As(err, &notConfigured) {
			h.clearOAuthStateCookie(w)
			WriteError(w, r, http.StatusServiceUnavailable,
				"OAUTH_NOT_CONFIGURED", "Google sign-in is not configured.", nil)
			return
		}
		h.clearOAuthStateCookie(w)
		http.Redirect(w, r, h.errorRedirect(oauthCallbackErrorCode(err, r)), http.StatusFound)
		return
	}

	// Success path: emit refresh-token cookie + clear oauth_state cookie
	// (replay defense) + redirect to post-login URL.
	h.setRefreshCookie(w, &service.LoginResult{
		RefreshToken: result.RefreshToken,
		RefreshTTL:   result.RefreshTTL,
	})
	h.clearOAuthStateCookie(w)

	dest := h.successRedirect(result)
	http.Redirect(w, r, dest, http.StatusFound)
}

// oauthCallbackErrorCode maps a service-layer error to the redirect
// query-param token. Defaults to "google_server_error" — any unmatched
// error indicates a logic gap, surface loudly via slog.
//
// google_timeout MUST be distinguished from google_userinfo_failed so
// operators can spot Google availability problems vs spec-compliance
// bugs (AC10).
func oauthCallbackErrorCode(err error, r *http.Request) string {
	var stateMissing *service.OAuthStateMissingError
	var stateInvalid *service.OAuthStateInvalidError
	var stateExpired *service.OAuthStateExpiredError
	var exchange *service.OAuthExchangeError
	var userinfoTimeout *service.OAuthUserinfoTimeoutError
	var userinfo *service.OAuthUserinfoError
	var emailUnverified *service.OAuthEmailUnverifiedError
	var tenantMismatch *service.OAuthTenantMismatchError
	var googleLinkRace *service.GoogleIDAlreadyLinkedError
	switch {
	case errors.As(err, &stateMissing), errors.As(err, &stateInvalid):
		return "csrf_invalid"
	case errors.As(err, &stateExpired):
		return "csrf_expired"
	case errors.As(err, &exchange):
		return "google_exchange_failed"
	case errors.As(err, &userinfoTimeout):
		return "google_timeout"
	case errors.As(err, &userinfo):
		return "google_userinfo_failed"
	case errors.As(err, &emailUnverified):
		return "google_email_unverified"
	case errors.As(err, &tenantMismatch):
		return "oauth_wrong_tenant"
	case errors.As(err, &googleLinkRace):
		return "google_link_race"
	}
	slog.Error("oauth callback unhandled error", "error", err, "path", r.URL.Path)
	return "google_server_error"
}

// successRedirect builds the post-login URL. When the invite succeeded
// the URL gets ?invited=true (center name omitted — see below). When an
// invite produced a recoverable error (mismatch, expired,
// already-accepted), the URL gets ?error=<code>.
//
// Privacy / SEC-11: invited-email and Google-email are NOT echoed in
// the URL even on mismatch. The URL ends up in browser history, web
// server access logs, proxy logs, and Referer headers for every
// outbound resource on the landing page (Sentry beacons, analytics,
// image loads). Echoing emails there would let an attacker probing
// random invite tokens via Google sign-in confirm which emails were
// invited. The SPA fetches details from a tenant-scoped follow-up
// endpoint after landing instead.
//
// `center` name is also NOT echoed — same reason — and to avoid
// emitting `center=` empty when fetchCenterName lost a race.
func (h *AuthHandler) successRedirect(result *service.GoogleCallbackResult) string {
	base := h.svc.AppPostLoginURL()
	if base == "" {
		base = "/"
	}
	u, err := url.Parse(base)
	if err != nil {
		return base
	}
	q := u.Query()
	if result.InviteSurface != nil {
		q.Set("error", inviteSurfaceErrorCode(result.InviteSurface))
	} else if result.InviteAccepted {
		q.Set("invited", "true")
	}
	u.RawQuery = q.Encode()
	return u.String()
}

func inviteSurfaceErrorCode(err error) string {
	var mismatch *service.InviteEmailMismatchError
	var expired *service.InviteExpiredError
	var already *service.InviteAlreadyAcceptedError
	switch {
	case errors.As(err, &mismatch):
		return "invite_email_mismatch"
	case errors.As(err, &expired):
		return "invite_expired"
	case errors.As(err, &already):
		return "invite_already_accepted"
	}
	return "invite_unknown_error"
}

// errorRedirect builds the failure redirect URL.
func (h *AuthHandler) errorRedirect(code string) string {
	base := h.svc.AppLoginErrorURLBase()
	if base == "" {
		base = "/login"
	}
	u, err := url.Parse(base)
	if err != nil {
		return base + "?error=" + code
	}
	q := u.Query()
	q.Set("error", code)
	u.RawQuery = q.Encode()
	return u.String()
}

// AcceptInvite implements POST /api/auth/accept-invite (AC4). This
// endpoint goes through the canonical middleware.ErrorMapper so error
// envelopes match the rest of the API.
func (h *AuthHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) error {
	var req acceptInviteRequestBody
	if err := decodeAuthBody(w, r, &req); err != nil {
		return model.ValidationError{Fields: []model.FieldError{{Field: "body", Message: "invalid JSON"}}}
	}
	// Failure-Path AC: over-cap inviteToken returns 400 INVALID_INVITE_TOKEN
	// at the boundary so the service layer never collapses oversize into a
	// 404 INVITE_NOT_FOUND (which would be wrong — the request is malformed,
	// not pointing at a missing row).
	if len(req.InviteToken) > service.MaxInviteTokenChars {
		WriteError(w, r, http.StatusBadRequest, "INVALID_INVITE_TOKEN", "Invite token is malformed.", nil)
		return nil
	}
	res, err := h.svc.AcceptInvite(r.Context(), service.AcceptInviteInput{
		Token:    req.InviteToken,
		FullName: req.FullName,
		Password: req.Password,
	})
	if err != nil {
		return err
	}
	h.setRefreshCookie(w, &service.LoginResult{
		RefreshToken: res.RefreshToken,
		RefreshTTL:   res.RefreshTTL,
	})
	WriteJSON(w, http.StatusOK, acceptInviteResponseBody{
		AccessToken: res.AccessToken,
		User: userSummary{
			ID:            uuid.UUID(res.User.ID.Bytes).String(),
			Email:         res.User.Email,
			FullName:      res.User.FullName,
			EmailVerified: res.User.EmailVerified,
		},
		Center: acceptInviteCenterPayload{ID: res.CenterID, Name: res.CenterName},
		Role:   res.Role,
	})
	return nil
}

// clearOAuthStateCookie emits a Set-Cookie with Max-Age=0 so the browser
// discards the existing oauth_state cookie. Same Path / Domain as the
// init endpoint so the discard matches.
func (h *AuthHandler) clearOAuthStateCookie(w http.ResponseWriter) {
	header, err := buildOAuthStateCookieHeader("", h.cookie, -1)
	if err != nil {
		return
	}
	w.Header().Add("Set-Cookie", header)
}

// buildOAuthStateCookieHeader is the oauth_state-specific cookie
// builder. Path is hard-coded to /api/auth (narrower than refresh_token's
// /). Otherwise mirrors buildCookieHeader's CRLF / ';' rejection.
func buildOAuthStateCookieHeader(value string, cfg CookieConfig, maxAge int) (string, error) {
	if strings.ContainsAny(value, "\r\n\t\x00;") {
		return "", errors.New("cookie value contains forbidden character")
	}
	var b strings.Builder
	b.WriteString(oauthStateCookieName)
	b.WriteByte('=')
	b.WriteString(value)
	b.WriteString("; Path=")
	b.WriteString(oauthStateCookiePath)
	if cfg.Domain != "" {
		if strings.ContainsAny(cfg.Domain, "\r\n\t\x00;") {
			return "", errors.New("cookie domain contains forbidden character")
		}
		b.WriteString("; Domain=")
		b.WriteString(cfg.Domain)
	}
	switch {
	case maxAge < 0:
		b.WriteString("; Max-Age=0")
	case maxAge > 0:
		b.WriteString("; Max-Age=")
		b.WriteString(strconv.Itoa(maxAge))
	}
	b.WriteString("; HttpOnly")
	if cfg.Secure {
		b.WriteString("; Secure")
	}
	switch cfg.SameSite {
	case http.SameSiteLaxMode:
		b.WriteString("; SameSite=Lax")
	case http.SameSiteStrictMode:
		b.WriteString("; SameSite=Strict")
	case http.SameSiteNoneMode:
		b.WriteString("; SameSite=None")
	}
	return b.String(), nil
}

// buildCookieHeader serializes a Set-Cookie header by hand so that a
// leading-dot Domain survives the round-trip — see setRefreshCookie's
// godoc for the rationale.
//
// Rejects CR / LF / ';' / '=' / NUL in either name or value to prevent
// header-injection (the helper bypasses stdlib http.SetCookie's
// validation by design — so the validation must live here). Today only
// callers are this file's internal helpers passing constant names and
// server-generated values, but the function is exported-shape so any
// future caller inherits the guard.
func buildCookieHeader(name, value string, cfg CookieConfig, maxAge int) (string, error) {
	if strings.ContainsAny(name, "\r\n\t\x00;= ") {
		return "", errors.New("cookie name contains forbidden character")
	}
	if strings.ContainsAny(value, "\r\n\t\x00;") {
		return "", errors.New("cookie value contains forbidden character")
	}
	var b strings.Builder
	b.WriteString(name)
	b.WriteByte('=')
	b.WriteString(value)
	b.WriteString("; Path=/")
	if cfg.Domain != "" {
		if strings.ContainsAny(cfg.Domain, "\r\n\t\x00;") {
			return "", errors.New("cookie domain contains forbidden character")
		}
		b.WriteString("; Domain=")
		b.WriteString(cfg.Domain)
	}
	switch {
	case maxAge < 0:
		b.WriteString("; Max-Age=0")
	case maxAge > 0:
		b.WriteString("; Max-Age=")
		b.WriteString(strconv.Itoa(maxAge))
	}
	b.WriteString("; HttpOnly")
	if cfg.Secure {
		b.WriteString("; Secure")
	}
	switch cfg.SameSite {
	case http.SameSiteLaxMode:
		b.WriteString("; SameSite=Lax")
	case http.SameSiteStrictMode:
		b.WriteString("; SameSite=Strict")
	case http.SameSiteNoneMode:
		b.WriteString("; SameSite=None")
	}
	return b.String(), nil
}
