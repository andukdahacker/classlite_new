# Epic 1B: Authentication

**Description:** Users can register, log in, manage sessions, reset passwords, sign in with Google, and accept staff invitations. Complete auth API with security-hardened flows.

**FRs Covered:** FR-75, FR-76, FR-77, FR-78, FR-79, FR-80, FR-81

**NFRs Addressed:** NFR-4 (security core)

**Stories:** 1.4, 1.5, 1.6

---

## Story 1.4: Email/Password Registration & Email Verification API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.3 (auth schema)

As a new user,
I want to register with my email and password and verify my email address,
So that I have a secure, verified account on the platform.

### Acceptance Criteria

**Given** a user submits a valid registration form with email and password,
**When** the registration request is processed,
**Then** a new user record is created with the password hashed using bcrypt, an email verification token is generated with a 24-hour expiry, and a verification email is sent via the email service abstraction (Resend).

**Given** a user submits a registration form with an email that already exists in the system,
**When** the registration request is processed,
**Then** the request is rejected with an appropriate error indicating the email is already in use (without revealing whether the account is verified or not, to prevent enumeration).

**Given** a user has received a verification email,
**When** they click the verification link containing the token,
**Then** their account is marked as verified and the token is invalidated.

**Given** a user has a verification token that is older than 24 hours,
**When** they attempt to verify their email with that token,
**Then** the request is rejected and the user is informed the token has expired and must request a new one.

**Given** a user requests a new verification email,
**When** the request is processed,
**Then** a new verification token is generated (invalidating any previous token), and a new email is sent.

**Given** a frontend client needs to know the verification status of a user,
**When** it polls the verify-status endpoint,
**Then** the endpoint returns the current verification state of the user's email.

**Given** registration and verification endpoints are exposed,
**When** excessive requests are made from a single source,
**Then** rate limiting is applied to prevent abuse.

**Given** the email service abstraction layer (Story 1.2d),
**When** a verification email needs to be sent,
**Then** it is sent through the abstraction layer using Resend as the provider, allowing future provider swaps without code changes.

### Failure-Path Acceptance Criteria

**Given** a user who has sent 5 verification emails in 10 minutes,
**When** they request another,
**Then** they receive a 429 Too Many Requests response with a `Retry-After` header indicating when they can try again.

**Given** a registration request with a malformed email (including SQL injection attempts, excessively long strings, or invalid characters),
**When** the request is processed,
**Then** it is rejected by input validation before any database interaction occurs, returning a 400 Bad Request with a sanitized error message.

**Given** the Resend email service is unavailable (network error, service outage, rate limit from provider),
**When** a registration request succeeds,
**Then** the user record is created in the database, a retry job is queued for the verification email delivery, and the user sees a message indicating "Email may be delayed" rather than a registration failure.

---

## Story 1.5: Login, Session Management & Password Reset API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.4

As a registered user,
I want to log in securely, have my session managed with rotating tokens, and reset my password if I forget it,
So that my account remains secure and I can always regain access.

### Acceptance Criteria

**Given** a user submits valid login credentials (email and password),
**When** the login request is processed,
**Then** a JWT access token (15-minute expiry) and a refresh token (7-day expiry for standard sessions, 30-day for "remember me") are issued. The refresh token is set as an httpOnly, secure, SameSite cookie.

**Given** a user's access token has expired,
**When** the client sends the refresh token,
**Then** a new access token and a new refresh token are issued (refresh token rotation), and the old refresh token is invalidated.

**Given** a user has failed login 5 times consecutively,
**When** they attempt a 6th login,
**Then** the account is locked out for 15 minutes, and the user is informed of the lockout with the remaining time.

**Given** a locked-out user waits for the lockout period to expire,
**When** they attempt to log in with correct credentials,
**Then** the login succeeds and the failure counter is reset.

**Given** a user requests a password reset,
**When** the request is processed,
**Then** a password reset token is generated and sent to the user's email (if the email exists; the response is identical whether or not the email is found, to prevent enumeration).

**Given** a user submits a valid password reset token with a new password,
**When** the reset is processed,
**Then** the password is updated (hashed with bcrypt), all existing sessions (refresh tokens) for the user are invalidated, and the reset token is consumed.

**Given** a user logs out,
**When** the logout request is processed,
**Then** the refresh token is invalidated and the httpOnly cookie is cleared.

### Rate Limit Storage

Rate limiting uses PostgreSQL-backed storage (not in-memory) so it functions correctly behind a load balancer across multiple API instances. Implementation uses a `rate_limits` table with columns: `key` (VARCHAR, primary key composite), `count` (INTEGER), `window_start` (TIMESTAMPTZ), `expires_at` (TIMESTAMPTZ). A periodic cleanup job removes expired rows.

### Failure-Path Acceptance Criteria

**Given** two browser tabs attempting a token refresh simultaneously (both sending the same refresh token),
**When** both requests reach the server,
**Then** token family detection handles the race condition: the first request succeeds and rotates the token; if the old (rotated-out) token is reused by the second tab, the system detects token reuse and revokes the entire token family, forcing the user to re-authenticate. This prevents session fixation and token theft scenarios.

**Given** a JWT with a valid cryptographic signature but referencing a user ID that has been deleted from the database,
**When** the auth middleware processes the request,
**Then** it returns a 401 Unauthorized response (not a 500 Internal Server Error), with the token treated as invalid.

**Given** the JWT signing key configuration,
**When** the API server starts up,
**Then** the signing key is loaded from an environment variable (e.g., `JWT_SIGNING_KEY`), validated to be at least 256 bits in length, and if the key is missing or too short, the API refuses to start and logs a clear error message indicating the configuration problem.

---

## Story 1.6: Google OAuth & Invite Acceptance API

**Size:** L | **Audience:** Backend | **Dependencies:** Story 1.5

As a user or invited staff member,
I want to sign in with my Google account and optionally accept a staff invitation during the OAuth flow,
So that I can use social login for convenience and seamlessly join a class when invited.

### Acceptance Criteria

**Given** a user clicks "Sign in with Google,"
**When** the OAuth flow is initiated,
**Then** the user is redirected to Google's consent screen with a CSRF nonce stored server-side (or in a secure, signed cookie) and included in the OAuth `state` parameter.

**Given** a user completes the Google consent screen,
**When** Google redirects back with an authorization code,
**Then** the callback endpoint validates the CSRF nonce from the `state` parameter, exchanges the code for tokens, retrieves the user's Google profile (email, name, avatar), and either creates a new account or links to an existing account matched by email.

**Given** a user already has an email/password account with the same email as their Google account,
**When** they sign in with Google for the first time,
**Then** the Google identity is linked to their existing account (account linking by email), and they can subsequently sign in with either method.

**Given** a user has been invited to join a class and clicks the invite link,
**When** the invite flow redirects through Google OAuth,
**Then** the invite token is piggybacked on the OAuth state parameter in the format `{nonce}:{inviteToken}`, and after successful authentication, the invite is automatically accepted.

**Given** a user accepts an invite via Google OAuth but the Google account email does not match the invited email,
**When** the callback processes the invite,
**Then** the email mismatch is handled according to business rules (either rejecting the invite acceptance with a clear error, or prompting the user to confirm linking), and the mismatch is logged for audit purposes.

**Given** an administrator force-logs out a staff member,
**When** the force-logout is processed,
**Then** all refresh tokens for that user are deleted, preventing new access tokens from being issued after the current access token expires.

### Failure-Path Acceptance Criteria

**Given** a Google OAuth callback with an invalid, expired, or replayed CSRF nonce in the `state` parameter,
**When** the callback endpoint processes the request,
**Then** the request is rejected with a 403 Forbidden status, and the user is redirected to the login page with `error=csrf_invalid` as a query parameter.

**Given** a Google OAuth callback where Google returns an error response (e.g., `access_denied` when the user refuses consent, or `server_error` from Google's side),
**When** the callback endpoint processes the error,
**Then** the user is redirected to the login page with a specific, user-friendly error code (e.g., `error=google_access_denied` or `error=google_server_error`) rather than a generic 500 Internal Server Error.

**Given** a partial OAuth flow where the user initiates Google sign-in but closes the Google consent screen without completing it,
**When** the user returns to the application,
**Then** the application state is clean with no dangling nonces left in an unresolvable state. Nonces have a short TTL (e.g., 10 minutes) and are automatically cleaned up on expiry.

**Given** a force-logout has been issued for a staff member but their current access token is still within the 15-minute validity window,
**When** the staff member makes API requests using that access token,
**Then** the requests succeed until the access token expires naturally. Force-logout only deletes refresh tokens, not access tokens. **This is a known limitation:** the staff member retains access for up to 15 minutes after force-logout. This tradeoff is accepted to avoid the performance cost of checking a token blocklist on every request, and must be documented in the API documentation and communicated to administrators.
