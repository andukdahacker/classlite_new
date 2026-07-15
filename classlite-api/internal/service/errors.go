// Package service — Story 1.5 typed errors.
//
// All errors in this file are returned as POINTERS so the ATDD tests'
// errors.As(err, &x) calls with `x *service.ErrType` succeed cleanly. The
// existing legacy value-receiver errors in `internal/model` (NotFoundError,
// ForbiddenError, ValidationError, ConflictError, GoneError) keep working
// via their own errors.As shape — both styles coexist.
//
// Mapping to HTTP envelopes happens in `middleware.error_mapper.go`. Each
// error here has a corresponding switch arm in that mapper.
package service

import "time"

// InvalidCredentialsError → 401 INVALID_CREDENTIALS. Used by Login for both
// the unknown-email path and the wrong-password path so the two cannot be
// distinguished from outside.
type InvalidCredentialsError struct{}

func (e *InvalidCredentialsError) Error() string { return "invalid email or password" }

// AccountLockedError → 429 ACCOUNT_LOCKED. RetryAfter is the remaining
// duration until the lockout window expires; the mapper rounds it up to
// whole seconds for the Retry-After header.
type AccountLockedError struct {
	RetryAfter time.Duration
}

func (e *AccountLockedError) Error() string { return "account locked" }

// TokenReuseDetectedError → 401 REFRESH_TOKEN_REUSE_DETECTED. Carries the
// family id for logging / audit emit; never echoed in the response body.
type TokenReuseDetectedError struct {
	FamilyID string
}

func (e *TokenReuseDetectedError) Error() string {
	return "refresh token reuse detected — family revoked"
}

// ResetTokenConsumedError → 409 RESET_TOKEN_CONSUMED. Distinct from
// model.GoneError (RESET_TOKEN_EXPIRED) so the UI can show different copy.
type ResetTokenConsumedError struct{}

func (e *ResetTokenConsumedError) Error() string { return "password reset token already used" }

// ForbiddenError → 403. Lives in service (vs. model.ForbiddenError) so the
// ATDD tests' pointer-typed errors.As(err, &fe *service.ForbiddenError) is
// satisfied. The handler mapper picks an envelope code based on the Reason
// — "insufficient role" maps to INSUFFICIENT_ROLE, else FORBIDDEN.
type ForbiddenError struct {
	Reason string
}

func (e *ForbiddenError) Error() string { return e.Reason }

// RefreshTokenInvalidError → 401 REFRESH_TOKEN_INVALID. Covers the
// lookup-miss-and-no-siblings path: attacker tried a bogus token, no
// family exists to revoke. Distinct from the reuse-detected case.
type RefreshTokenInvalidError struct{}

func (e *RefreshTokenInvalidError) Error() string { return "refresh token invalid" }

// AuthUserGoneError → 401 AUTH_USER_GONE. The JWT verified, but the
// underlying users row was deleted between issuance and now (AC16).
type AuthUserGoneError struct{}

func (e *AuthUserGoneError) Error() string { return "authentication user no longer exists" }

// InvalidTenantClaimError → 403 INVALID_TENANT_CLAIM. The JWT verified,
// but its center_id claim points to a center where the user has no
// active membership (AC14).
type InvalidTenantClaimError struct{}

func (e *InvalidTenantClaimError) Error() string {
	return "JWT center_id has no active membership"
}

// ---------------------------------------------------------------------
// Story 1.6 — Google OAuth flow errors.
//
// These errors are returned by AuthService.HandleGoogleCallback. They do
// NOT flow through middleware/error_mapper.go because the OAuth callback
// emits 302 redirects to the SPA's login URL with ?error=<code> query
// params (browser navigation, not an API call). The handler maps each
// pointer-typed error to a specific error_query string — see the
// AuthHandler.GoogleCallback Task 7 implementation for the mapping.
// ---------------------------------------------------------------------

// OAuthStateMissingError → ?error=csrf_invalid. The oauth_state cookie
// is absent on the callback — either the user came in via a stale link,
// has cookies disabled, or a CSRF probe is reaching the endpoint without
// having visited /api/auth/google first.
type OAuthStateMissingError struct{}

func (e *OAuthStateMissingError) Error() string { return "oauth state cookie missing" }

// OAuthStateInvalidError → ?error=csrf_invalid. HMAC verification failed
// OR cookie value didn't match the state query param byte-for-byte. The
// two failure modes share the same external code: a probing attacker
// must not learn which check rejected the request.
type OAuthStateInvalidError struct{}

func (e *OAuthStateInvalidError) Error() string { return "oauth state HMAC verification failed" }

// OAuthStateExpiredError → ?error=csrf_expired. State payload's
// IssuedAt + 10 min < clock.Now(). The user took too long between
// hitting init and completing Google's consent screen.
type OAuthStateExpiredError struct{}

func (e *OAuthStateExpiredError) Error() string { return "oauth state TTL exceeded" }

// OAuthExchangeError → ?error=google_exchange_failed. oauth2.Config
// Exchange returned an error — usually a Google-side issue (network,
// invalid_grant, redirect_uri_mismatch). UpstreamErr is logged via slog
// for forensics; never echoed in the redirect (could leak Google API
// implementation details).
type OAuthExchangeError struct{ UpstreamErr string }

func (e *OAuthExchangeError) Error() string { return "oauth code exchange failed: " + e.UpstreamErr }

// OAuthUserinfoError → ?error=google_userinfo_failed. The userinfo HTTP
// call to Google failed (non-2xx, decode failure, non-timeout transport
// error). Reason carries the categorical failure mode for logs only.
type OAuthUserinfoError struct{ Reason string }

func (e *OAuthUserinfoError) Error() string { return "oauth userinfo: " + e.Reason }

// OAuthUserinfoTimeoutError → ?error=google_timeout. Distinct from the
// generic userinfo failure so operators can spot Google availability
// problems vs spec-compliance bugs (AC10).
type OAuthUserinfoTimeoutError struct{}

func (e *OAuthUserinfoTimeoutError) Error() string { return "oauth userinfo timeout" }

// OAuthNotConfiguredError → 503 OAUTH_NOT_CONFIGURED. The Google OAuth
// client or state signer was never installed (dev parity or operator
// missed an env var). Distinct from *OAuthExchangeError so the SPA and
// audit logs don't falsely blame Google.
type OAuthNotConfiguredError struct{}

func (e *OAuthNotConfiguredError) Error() string { return "oauth not configured" }

// InviteRoleConflictError → 409 INVITE_ROLE_CONFLICT. The user already
// has a center_members row for the invite's center but under a
// different role than the invite was sent for. Reserved for the future
// "reject and surface" UX choice; the current implementation upgrades
// in place per the Story 1.6 review decision.
type InviteRoleConflictError struct {
	CurrentRole string
	InvitedRole string
}

func (e *InviteRoleConflictError) Error() string {
	return "user already has different role in this center"
}

// OAuthEmailUnverifiedError → ?error=google_email_unverified. Google
// returned email_verified=false on the profile. Rare (federated identities,
// legacy Workspace setups) but a hard reject — ClassLite's email
// verification gate cannot be bypassed by an unverified Google email.
type OAuthEmailUnverifiedError struct{}

func (e *OAuthEmailUnverifiedError) Error() string { return "google email not verified" }

// OAuthTenantMismatchError → ?error=oauth_wrong_tenant. AC3: callback
// landed on subdomain.classlite.app, but the resolved user has no
// center_members row for the slug's center. The R6 mitigation — never
// auto-bind a Google identity to a tenant the user isn't a member of.
type OAuthTenantMismatchError struct {
	RequestedHost string
	UserID        string
}

func (e *OAuthTenantMismatchError) Error() string { return "oauth tenant binding failed" }

// GoogleIDAlreadyLinkedError → ?error=google_link_race. AC2 Branch B
// race protection: two simultaneous OAuth linkers for the same email →
// LinkGoogleAccount's WHERE google_id IS NULL means only one wins; the
// loser sees 0 rows affected. Surfaces explicitly so the user knows
// "try again" is the right next step (on retry, Branch A fires).
type GoogleIDAlreadyLinkedError struct{}

func (e *GoogleIDAlreadyLinkedError) Error() string {
	return "google_id already linked to another account"
}

// ---------------------------------------------------------------------
// Story 1.6 — Invite-acceptance errors.
//
// These flow through middleware/error_mapper.go (JSON envelope responses)
// because POST /api/auth/accept-invite is an API call. The OAuth-callback
// variant of invite errors surfaces via redirect query params (handler
// maps the same pointer types to query params, not envelopes).
// ---------------------------------------------------------------------

// InviteNotFoundError → 404 INVITE_NOT_FOUND. Either the token is bogus
// or the row was deleted. Same response either way — no enumeration.
type InviteNotFoundError struct{}

func (e *InviteNotFoundError) Error() string { return "invite not found" }

// InviteExpiredError → 410 INVITE_EXPIRED. The invite was valid but its
// expires_at has passed. CenterName + InviterEmail are echoed in the
// error envelope's details so the frontend can render the UX recovery
// path ("Ask <inviter> to send a new one" — UX line 580).
type InviteExpiredError struct {
	CenterName   string
	InviterEmail string
}

func (e *InviteExpiredError) Error() string { return "invite expired" }

// InviteAlreadyAcceptedError → 409 INVITE_ALREADY_ACCEPTED. The invite
// row already has accepted_at != NULL. CenterName is echoed in details
// so the frontend can redirect to login per UX line 581 ("You've already
// joined [center]").
type InviteAlreadyAcceptedError struct {
	CenterName string
}

func (e *InviteAlreadyAcceptedError) Error() string { return "invite already accepted" }

// InviteEmailMismatchError → 409 INVITE_EMAIL_MISMATCH (REST path), or
// ?error=invite_email_mismatch (OAuth callback path). The Google account
// the user signed in with has a different email than the invite was
// addressed to. The invite is NOT consumed; the Google sign-in itself
// still succeeds — the user just can't join this specific invite.
type InviteEmailMismatchError struct {
	InvitedEmail string
	OAuthEmail   string
}

func (e *InviteEmailMismatchError) Error() string {
	return "oauth email differs from invited email"
}

// PasswordNotAllowedForOAuthUserError → 409 PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER.
// Existing user has password_hash NULL (Google-only account) but the
// invite-acceptance request supplied a password. The fix is to accept
// the invite via Google, not via password. Silent-ignore would let an
// attacker who guessed an OAuth-only email mint a password via an old
// invite token they captured somewhere.
type PasswordNotAllowedForOAuthUserError struct{}

func (e *PasswordNotAllowedForOAuthUserError) Error() string {
	return "user has google-only account; password not accepted"
}

// ---------------------------------------------------------------------
// Story 2-5a — Settings errors.
// ---------------------------------------------------------------------

// UnsupportedTimezoneError → 422 UNSUPPORTED_TIMEZONE. The caller sent
// a timezone that is not in the 30-entry IANA whitelist enforced by the
// Settings service (Winston-S8 fold — the frontend + backend whitelists
// stay in lockstep via settings_timezone_parity_test.go). Distinct from
// model.ValidationError so the UI can render a targeted "Not on the
// supported list" message and the mapper can emit a stable code.
type UnsupportedTimezoneError struct {
	Timezone string
}

func (e *UnsupportedTimezoneError) Error() string {
	return "unsupported timezone: " + e.Timezone
}

// TenantMismatchError → 403 TENANT_MISMATCH. The path `{id}` on the
// Settings endpoints does not match the caller's TenantContext.CenterID.
// `centers` is a global-no-RLS table (see docs/project-context.md §GO-1),
// so this handler-layer check is the sole gate protecting a caller from
// reading or mutating another center's row. Reserved for handler entry
// (Winston-S3 + John ACCEPT belt-and-suspenders fold).
type TenantMismatchError struct {
	PathCenterID    string
	ContextCenterID string
}

func (e *TenantMismatchError) Error() string {
	return "tenant mismatch: path center id does not match session"
}

// PayloadTooLargeError → 413 PAYLOAD_TOO_LARGE. P14 (2026-07-15 code
// review): a request body that exceeds the endpoint cap (16 KiB on
// Settings) previously collapsed into a 422 "invalid JSON" ValidationError
// (which shipped the raw MaxBytesError bytes surface). 413 is the RFC 7231
// correct status for "the request is larger than the server is willing to
// process" and lets the client render targeted "payload too big" UX.
type PayloadTooLargeError struct {
	LimitBytes int64
}

func (e *PayloadTooLargeError) Error() string {
	return "request body exceeds server limit"
}
