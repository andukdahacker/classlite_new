// Package service — Story 9.4 self-profile typed errors (GO-2). The handler
// error mapper does a type switch on these to produce the correct HTTP status +
// stable UPPER_SNAKE_CASE code; a stdlib error would collapse to 500.
package service

// InvalidCurrentPasswordError is returned by ChangePassword when the supplied
// current password does not match the stored hash (AC4). Maps to 403
// INVALID_CURRENT_PASSWORD — deliberately NOT 401, so the FE never mistakes it
// for an expired session and trips the TS-5 silent-refresh/redirect path.
// Distinct from the login InvalidCredentialsError so
// the FE can surface it inline against the current-password field rather than as
// a login-style toast — and so a password CHANGE failure is never confused with
// a sign-in failure in logs.
type InvalidCurrentPasswordError struct{}

func (e *InvalidCurrentPasswordError) Error() string { return "current password is incorrect" }

// PasswordNotSetError is returned by ChangePassword when the account has no
// password hash — an OAuth-only (Google sign-in) user (AC4). Maps to 409
// PASSWORD_NOT_SET so the caller never sees a 500, and the FE can render the
// single "You sign in with Google" explanatory state (AC7).
type PasswordNotSetError struct{}

func (e *PasswordNotSetError) Error() string { return "account has no password set" }
