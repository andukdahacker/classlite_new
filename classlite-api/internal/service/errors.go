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

import (
	"fmt"
	"strconv"
	"time"
)

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

// ReasonTemplateReadOnly is the ForbiddenError.Reason the error mapper keys on
// to emit the TEMPLATE_READONLY 403 code (Story 3.3 — a system-seed template is
// immutable). Distinct from "insufficient role" so the SPA can render a clear
// "seeds can't be edited" message instead of a generic role error.
const ReasonTemplateReadOnly = "template is read-only"

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

// RoomNameTakenError → 409 ROOM_NAME_TAKEN. Story 2-5b AC6 pins that a
// duplicate room name (case-insensitive per UNIQUE(center_id, LOWER(name))
// index) surfaces as an inline field error on `name`, not a toast. The
// service catches *pgconn.PgError with Code=="23505" from the sqlc-emitted
// CreateRoom/UpdateRoom and maps to this error type.
type RoomNameTakenError struct {
	Name string
}

func (e *RoomNameTakenError) Error() string {
	return "room name already exists in this center: " + e.Name
}

// ---------------------------------------------------------------------
// Story 2-5c — Google Meet OAuth per-center integration errors.
//
// Unlike Story 1.6 login OAuth (which flows through 302 redirects and
// bypasses error_mapper), the Meet OAuth callback IS wrapped in
// middleware.ErrorMapper — sad-path responses are JSON envelopes with
// stable error codes per AC5. Success alone returns 302 (browser flow
// back to /settings?tab=integrations&status=connected).
// ---------------------------------------------------------------------

// OAuthStateMismatchError → 403 OAUTH_STATE_MISMATCH. Story 2-5c AC7
// triple-binding: payload.CenterID must equal path{id} AND tc.CenterID,
// and payload.UserID must equal tc.UserID. Any mismatch → this error.
// Closes the confused-deputy attack surface where Owner A initiates
// Connect on Center A + attacker intercepts + swaps in Center B's path.
type OAuthStateMismatchError struct {
	Reason string
}

func (e *OAuthStateMismatchError) Error() string {
	if e.Reason == "" {
		return "oauth state binding mismatch"
	}
	return "oauth state binding mismatch: " + e.Reason
}

// OAuthMembershipRevokedError → 403 OAUTH_MEMBERSHIP_REVOKED. Story 2-5c
// AC5 step 3 fresh membership re-check: between the authorize redirect
// and Google's callback (up to 10-min TTL window), the Owner may have
// been demoted or removed from the center. Persisting tokens after a
// revoke would grant the ex-Owner ongoing access — reject instead.
type OAuthMembershipRevokedError struct {
	UserID   string
	CenterID string
}

func (e *OAuthMembershipRevokedError) Error() string {
	return "owner membership revoked between authorize and callback"
}

// IntegrationConnectFailedError → 502 INTEGRATION_CONNECT_FAILED. Story
// 2-5c AC5 step 6/10: the OAuth code exchange failed OR the token upsert
// tx rolled back. Provider identifies which integration surface hit the
// error (google_meet in v1). UpstreamErr is logged for forensics but
// never echoed back to the client (opaque Google-side details).
type IntegrationConnectFailedError struct {
	Provider    string
	UpstreamErr string
}

func (e *IntegrationConnectFailedError) Error() string {
	return "integration connect failed: " + e.Provider
}

// ---------------------------------------------------------------------
// Story 2.6 — Owner/Admin staff invite errors.
// ---------------------------------------------------------------------

// RoleAssignmentForbiddenError → 403 ROLE_ASSIGNMENT_FORBIDDEN. FR-11:
// only an Owner may assign the Owner role. An Admin caller passes the
// `RequireRole("owner","admin")` middleware gate but must still be
// rejected by the service layer when their invite payload names the
// Owner role. Distinct from *ForbiddenError so the error mapper can
// surface a targeted code (the frontend renders the copy at
// `people.invite.error.roleAssignmentForbidden`).
type RoleAssignmentForbiddenError struct{}

func (e *RoleAssignmentForbiddenError) Error() string {
	return "only an Owner can assign the Owner role"
}

// InviteEmailTakenError → 409 INVITE_EMAIL_TAKEN. An active (unexpired,
// unaccepted) invite row already exists for this email on this center.
// The error envelope carries `details.field = "email"` so the frontend
// can render an inline field error rather than a top-of-form toast.
type InviteEmailTakenError struct {
	Email string
}

func (e *InviteEmailTakenError) Error() string {
	return "active invite already exists for email: " + e.Email
}

// ---------------------------------------------------------------------
// Story 3.4 — Session scheduling errors.
//
// These flow through middleware/error_mapper.go. SESSION_NOT_FOUND (404) and
// SESSION_CONFLICT (409) reuse the legacy model.NotFoundError / model.ConflictError
// with an explicit Code, so only the three 422-family codes below need their
// own pointer types (the generic ValidationError arm would collapse them all
// to VALIDATION_ERROR).
// ---------------------------------------------------------------------

// SessionAlreadyStartedError → 422 SESSION_ALREADY_STARTED. A mutating scope of
// 'this' targeted a session whose starts_at is already in the past (immutable —
// protects 3.5 attendance).
type SessionAlreadyStartedError struct{}

func (e *SessionAlreadyStartedError) Error() string { return "session has already started" }

// RecurrenceLimitExceededError → 422 RECURRENCE_LIMIT_EXCEEDED. The requested
// recurrence would materialize more than the per-series cap. MaxReachableDate
// tells the client the furthest end date reachable for the chosen pattern.
type RecurrenceLimitExceededError struct {
	Cap              int
	MaxReachableDate string
}

func (e *RecurrenceLimitExceededError) Error() string {
	return "recurrence exceeds the maximum of " + strconv.Itoa(e.Cap) +
		" occurrences (furthest reachable end date: " + e.MaxReachableDate + ")"
}

// ScheduleRangeTooWideError → 422 SCHEDULE_RANGE_TOO_WIDE. A list window wider
// than the server cap (no unbounded month×JOIN scans).
type ScheduleRangeTooWideError struct {
	MaxDays int
}

func (e *ScheduleRangeTooWideError) Error() string {
	return "schedule range exceeds the maximum window of " + strconv.Itoa(e.MaxDays) + " days"
}

// ---------------------------------------------------------------------
// Story 3.4.5 — Enrollment linkage errors.
//
// ALREADY_ENROLLED (409) reuses model.ConflictError with an explicit Code, so
// only the distinct 422 code below needs its own pointer type (the generic
// ValidationError arm would collapse it to VALIDATION_ERROR).
// ---------------------------------------------------------------------

// NotAStudentMemberError → 422 NOT_A_STUDENT_MEMBER. The studentId on a
// POST /api/enrollments is not a `student` center-member of the caller's center
// (a non-member, or a member with a staff role). Distinct from the generic
// ValidationError so the SPA can render a targeted "not a student" message.
type NotAStudentMemberError struct {
	StudentID string
}

func (e *NotAStudentMemberError) Error() string {
	return "user is not a student member of this center"
}

// ---------------------------------------------------------------------
// Story 2.7 — Bulk student import errors.
//
// IMPORT_FILE_NOT_FOUND (404) reuses model.NotFoundError with an explicit Code,
// and the cross-tenant file-key 403 reuses model.ForbiddenError, so only the
// distinct 422 row-limit code below needs its own pointer type (the generic
// ValidationError arm would collapse it to VALIDATION_ERROR).
// ---------------------------------------------------------------------

// ImportRowLimitError → 422 IMPORT_ROW_LIMIT_EXCEEDED. The upload carried more
// than Limit data rows (header excluded). It is both a UX cap and a tx-budget
// cap (AC6). Got is the actual data-row count for the message.
type ImportRowLimitError struct {
	Limit int
	Got   int
}

func (e *ImportRowLimitError) Error() string {
	return fmt.Sprintf("import exceeds the maximum of %d rows per import (got %d)", e.Limit, e.Got)
}

// ImportFileTooLargeError → 413 IMPORT_FILE_TOO_LARGE. The uploaded object
// exceeds the server-side parse cap (code review P1). The R2 download is bounded
// by io.LimitReader to the cap, so a large or decompression-bomb upload cannot
// be read fully into memory before this check fires. Distinct from
// PayloadTooLargeError (which bounds the JSON request body) so the SPA can
// render targeted "your file is too large" UX.
type ImportFileTooLargeError struct {
	LimitBytes int64
	GotBytes   int64
}

func (e *ImportFileTooLargeError) Error() string {
	return fmt.Sprintf("import file exceeds the maximum of %d bytes (got at least %d)", e.LimitBytes, e.GotBytes)
}

// ---------------------------------------------------------------------
// Story 4.1 — Exercise optimistic-concurrency precondition.
//
// A STALE precondition reuses model.ConflictError{Code:"CONFLICT"} (→ 409). A
// MISSING precondition on the editor PATCH needs its own 428 type below (there
// is no 428 arm elsewhere and the generic ValidationError arm would flatten it
// to a 422 VALIDATION_ERROR).
// ---------------------------------------------------------------------

// PreconditionRequiredError → 428 PRECONDITION_REQUIRED. The exercise PATCH
// (the 4.2-autosave contract) arrived without an If-Match header or a body
// `updatedAt` — the editor path MUST send the freshly-read updatedAt so a
// silent multi-tab last-writer-wins clobber cannot happen (Winston). Distinct
// from a stale precondition (409 CONFLICT).
type PreconditionRequiredError struct{}

func (e *PreconditionRequiredError) Error() string {
	return "an updatedAt precondition is required for this update"
}

// IntegrationConnectCanceledError → handled at the handler layer as a 302
// redirect to /settings?tab=integrations&status=cancelled, NOT a JSON error
// envelope. Fires when Google's callback returns `?error=access_denied` (or
// similar) — the user hit Cancel on the consent screen or Google's admin
// policy blocked the grant. Distinct from IntegrationConnectFailedError so
// the frontend can render a neutral toast (not the red error banner). The
// UpstreamReason field carries Google's raw error param for forensics.
type IntegrationConnectCanceledError struct {
	Provider       string
	UpstreamReason string
}

func (e *IntegrationConnectCanceledError) Error() string {
	if e.UpstreamReason == "" {
		return "integration connect canceled: " + e.Provider
	}
	return "integration connect canceled: " + e.Provider + " (" + e.UpstreamReason + ")"
}

// ---------------------------------------------------------------------
// Story 5.1 — assignment + submission lifecycle errors. Each is a distinct
// pointer type so the error mapper emits a distinct code the generic
// ValidationError/ConflictError arms would otherwise flatten.
// ---------------------------------------------------------------------

// InvalidReferenceError → 422 INVALID_REFERENCE (AC2). The exerciseId or classId
// on an assignment create does not resolve to a live row in the caller's center
// (pre-checked; also the FK 23503 fallback). Field names the offending reference.
type InvalidReferenceError struct {
	Field string
}

func (e *InvalidReferenceError) Error() string {
	return "referenced record does not exist: " + e.Field
}

// InvalidDeadlineError → 422 INVALID_DEADLINE (AC4). hardDeadlineAt precedes
// deadlineAt.
type InvalidDeadlineError struct{}

func (e *InvalidDeadlineError) Error() string {
	return "hard deadline must be at or after the soft deadline"
}

// NotEnrolledError → 403 NOT_ENROLLED (AC8). The caller is not actively enrolled
// in the assignment's class; re-checked on start, progress, AND submit.
type NotEnrolledError struct{}

func (e *NotEnrolledError) Error() string {
	return "you are not actively enrolled in this class"
}

// SubmissionExistsError → 409 SUBMISSION_EXISTS (AC7). A terminal (submitted+)
// submission already exists for this (assignment, student) — start is refused.
type SubmissionExistsError struct{}

func (e *SubmissionExistsError) Error() string {
	return "a submission already exists for this assignment"
}

// SubmissionNotEditableError → 409 SUBMISSION_NOT_EDITABLE (AC9). A save/submit
// hit a row that is not in_progress (the DB-guarded UPDATE matched 0 rows).
type SubmissionNotEditableError struct{}

func (e *SubmissionNotEditableError) Error() string {
	return "this submission can no longer be edited"
}

// SubmissionLockedError → 409 SUBMISSION_LOCKED (AC13). The assignment is closed
// or its inclusive hard deadline has passed; no write is permitted.
type SubmissionLockedError struct{}

func (e *SubmissionLockedError) Error() string {
	return "this assignment is closed or past its hard deadline"
}

// TimeExpiredError → 409 TIME_EXPIRED (AC10). A save arrived after the exercise's
// server-side time limit (+ grace) elapsed; the last-saved content stands.
type TimeExpiredError struct{}

func (e *TimeExpiredError) Error() string {
	return "the time limit for this attempt has expired"
}

// ExerciseLockedError → 409 EXERCISE_LOCKED (AC15). A content edit or delete was
// attempted on an exercise that has >= 1 submission (FR-23). Distinct from the
// stale-precondition CONFLICT so the editor branches to the read-only strip.
type ExerciseLockedError struct{}

func (e *ExerciseLockedError) Error() string {
	return "this exercise is locked because it has submissions"
}
