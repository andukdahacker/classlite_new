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
