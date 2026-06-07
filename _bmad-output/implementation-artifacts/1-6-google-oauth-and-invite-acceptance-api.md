---
baseline_commit: 2b990976ae0d92193b6cd5b89bf3aa3b6c95dc62
---

# Story 1.6: Google OAuth & Invite Acceptance API

Status: ready-for-dev

<!-- Validation is optional. Run `validate-create-story` for a quality second pass before `dev-story`. -->

## Story

As a user or invited staff member,
I want to sign in with my Google account and optionally accept a staff invitation during the OAuth flow (or via an email/password fallback) and have an Owner-controlled force-logout primitive available for staff members,
so that I get one-tap Gmail sign-in (the dominant Vietnamese mailbox), invite acceptance is a single round-trip even when piggybacked on the OAuth state, and an Owner can revoke a compromised staff session immediately — without breaking the multi-tenant isolation guarantees that Stories 1.3–1.5 just hardened.

## Acceptance Criteria (BDD)

> **Risk map for this story** (per `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` and `test-design-architecture.md`):
> **R6** "Google OAuth callback skips tenant binding" — score **6**.
> **R7** "httpOnly cookie attributes weakened" — score **6** (shared with Story 1.5; this story emits a new OAuth state cookie that MUST honor the same four attributes).
> Force-logout adds an implicit re-use of **R1** (cross-tenant data leakage) and **R5** (refresh-token family revocation must work via bulk delete too).
> **WF-8 mandates ATDD red tests for every score-≥6 AC before dev** — these have NOT yet been authored for 1.6 (the Story 1.5 ATDD batch in commit `20ddce1` did not cover OAuth / invite / force-logout). Either run `/bmad-tea AT` to produce the red phase first, OR have the dev write the assertions inline as TDD using the patterns established by the 1.5 ATDD files. The dev contract is identical either way: every AC below must have at least one failing test on the branch BEFORE implementation begins.

### AC1: Initiate Google OAuth issues a CSRF-bound state and redirects to Google's consent screen

**Given** a `GET /api/auth/google?inviteToken=<optional>&redirectTo=<optional>` request from an unauthenticated client,
**When** the request is processed,
**Then** the API:
1. Generates a 32-byte cryptographically random nonce (`crypto/rand`).
2. Builds an HMAC-signed state payload `{ nonce, inviteTokenHash?, redirectTo?, issuedAt }` using a new server secret `OAUTH_STATE_SECRET` (≥ 32 bytes, validated at startup like `JWT_SECRET`). The signed token is base64url(`payload.b64url` + `.` + `hmac256(payload.b64url, OAUTH_STATE_SECRET).b64url`).
3. Sets a new httpOnly cookie `oauth_state` carrying the signed token (all four AC10 attributes from Story 1.5: `HttpOnly`, `Secure`, `SameSite=Lax`, `Domain=<cookie domain>`, `Path=/api/auth`, `Max-Age=600` — 10-minute TTL).
4. Responds with `302 Found` and a `Location` header pointing at Google's authorization URL (`https://accounts.google.com/o/oauth2/v2/auth`) with query params: `client_id`, `redirect_uri = GOOGLE_REDIRECT_URL`, `response_type=code`, `scope=openid email profile`, `state=<signed token>`, `access_type=online`, `prompt=select_account`.

**And** the `inviteToken` query param is NOT echoed verbatim in the cookie; instead its SHA-256 is stored in the state payload so the callback can re-bind it without the raw token leaking via cookie storage (parity with Story 1.5's refresh-token hashing).

**And** when `inviteToken` is present, the API performs a best-effort lookup (`get_invite_by_token_hash` — see Task 2 SECURITY DEFINER function) to verify the invite exists AND is not expired AND not already accepted. On miss, the response is `404` envelope `{ error: { code: "INVITE_NOT_FOUND", message: "This invite link is no longer valid.", requestId, details: null } }` — Google flow is NOT initiated. (Otherwise the user round-trips through Google only to discover the invite is dead — bad UX, free DoS amplifier.)

**And** when `redirectTo` is present, it MUST be validated against a same-origin allowlist (`https://my.classlite.app/*`, `https://*.classlite.app/*`, dev: `http://localhost:5173/*`). Mismatch → strip silently (defense against open-redirect via OAuth state).

_Mock seam:_ tests inject a `clock.Clock` for `issuedAt` and a deterministic `randomReader io.Reader` for nonce generation so the entire state payload is reproducible.

### AC2: Google OAuth callback validates state, exchanges code, retrieves profile, creates-or-links user

**Given** a `GET /api/auth/google/callback?code=<authcode>&state=<signed>` request,
**When** the request is processed,
**Then** the API performs these checks in this exact order, short-circuiting on the first failure:
1. **Cookie present:** `oauth_state` cookie exists. Absent → 403 `OAUTH_STATE_MISSING`, redirect to `${LOGIN_URL}?error=csrf_invalid`.
2. **HMAC valid:** `state` query param equals the cookie value byte-for-byte AND the signature verifies under `OAUTH_STATE_SECRET`. Mismatch → 403 `OAUTH_STATE_INVALID`, redirect to `${LOGIN_URL}?error=csrf_invalid`.
3. **TTL fresh:** `issuedAt + 10m > clock.Now()`. Stale → 403 `OAUTH_STATE_EXPIRED`, redirect to `${LOGIN_URL}?error=csrf_expired`.
4. **Code exchange:** `oauth2.Config.Exchange(ctx, code)` — converts authcode → access token. On Google-side error (network, `invalid_grant`, `redirect_uri_mismatch`) → log via slog with the upstream error string, respond 502 `OAUTH_EXCHANGE_FAILED`, redirect `${LOGIN_URL}?error=google_exchange_failed`.
5. **Profile fetch:** call `https://www.googleapis.com/oauth2/v3/userinfo` with the access token. Required fields: `email` (string), `email_verified` (bool, MUST be true — reject `false` with `OAUTH_EMAIL_UNVERIFIED` → redirect `?error=google_email_unverified`), `sub` (Google ID string), `name`, `picture` (optional).
6. **Account resolution:** call new `service.AuthService.resolveGoogleIdentity(ctx, profile)`:
   - **Branch A — match on `google_id`:** `GetUserByGoogleID(profile.sub)` returns a user → use as session user.
   - **Branch B — match on `email`:** else `GetUserByEmail(normalize(profile.email))` returns a user — **link** by setting `google_id = profile.sub` via new `LinkGoogleAccount` query (UPDATE users SET google_id = $2, email_verified = true, updated_at = now() WHERE id = $1 AND google_id IS NULL). The `WHERE google_id IS NULL` predicate is the race guard: if two simultaneous OAuth linkers hit the same email, the second sees 0 rows affected → 409 `GOOGLE_ID_ALREADY_LINKED` (the rare race that means someone else linked first; surfaces as `?error=google_link_race`).
   - **Branch C — no match:** create a new user via `CreateUser` with `password_hash = NULL`, `google_id = profile.sub`, `email_verified = true`, `full_name = profile.name`, `avatar_url = profile.picture` (nullable).
7. **Invite binding (if state carried `inviteTokenHash`):** call `AcceptInviteInternal(ctx, userID, inviteTokenHash, oauthProfileEmail)` — see AC4 for the full contract. If acceptance returns `EmailMismatchError`, redirect `${LOGIN_URL}?error=invite_email_mismatch&expectedEmail=<urlencoded>&googleEmail=<urlencoded>` (per FR-79 + UX recovery contract — UX spec specifies the user must see expected vs used email).
8. **Issue session:** delegate to `AuthService.issueSession(ctx, user, rememberMe=false)` — same path Login uses (mint access JWT + refresh row + Set-Cookie). Refresh-token cookie attributes mirror Login's `CookieConfig` exactly.

**And** the response is `302 Found` to `${APP_POST_LOGIN_URL}` (dev: `http://localhost:5173/` — staff lands on dashboard; freshly-invited staff lands on `${APP_POST_LOGIN_URL}?invited=true&center=<centerName>` so the frontend can show a welcome banner).

**And** the `oauth_state` cookie is cleared (`Max-Age=0`) on every callback response (success and failure) so a replay of the same cookie/state pair after a successful login is impossible.

**And** post-commit audit rows are written:
- Branch A: `event = "auth.google_signin"`, `entity_type = "user"`, `entity_id = user.id`, `Changes{ After: { method: "google", linked: false } }`.
- Branch B: `event = "auth.google_account_linked"`, `Changes{ Before: { googleId: null }, After: { googleId: profile.sub } }`.
- Branch C: `event = "auth.google_account_created"`, `Changes{ After: { method: "google", emailVerified: true } }`.
- Invite branch: additional `event = "invite.accepted_via_oauth"`, `entity_type = "invite"`, `entity_id = invite.id`, `Changes{ After: { centerId: invite.center_id, role: invite.role } }`.

### AC3: Tenant-binding enforcement on Google OAuth callback (R6)

**Given** a Google OAuth callback that resolves to an existing user via Branch A or B **and** the callback request arrived on a tenant subdomain (`Host: <slug>.classlite.app`),
**When** the request is processed,
**Then** before issuing the session the API asserts that `(user.id, <slug>'s center_id)` exists in `center_members` with `role IN ('owner', 'admin', 'teacher', 'student')`.

**And** on miss, the response is `403 Forbidden` redirected to `${LOGIN_URL}?error=oauth_wrong_tenant&host=<urlencoded slug>` — never 404 (that would leak whether the user exists at all in the platform).

**And** an `auth_audit_logs` row is written with `event = "auth.oauth_tenant_mismatch"`, `user_id = user.id`, `Changes{ After: { requestedTenantSlug: <slug>, userHasMembership: false } }` — SOC tooling can surface accidental cross-subdomain login attempts.

**And** when the callback arrives on the apex host (`Host: my.classlite.app` — the unscoped sign-in surface), the membership check is **skipped**. The frontend post-login flow routes the user to a center-picker if they have multiple memberships, or auto-selects the only membership.

**Caveat for MVP host setup:** Story 1.6 ships before the subdomain-routing story (tracked in Epic 1C). For MVP, treat `Host` resolution as "if `Host == APP_APEX_HOST` (env `APP_APEX_HOST`, dev default `localhost:5173`) skip the bind; else extract the leading label as the slug and run the assertion." This contract is forward-compatible — Epic 1C just sets `APP_APEX_HOST` to `my.classlite.app` in prod env without touching this code.

_Pinned by ATDD (to be authored): `service/google_oauth_atdd_test.go::TestGoogleCallback_AC03_TenantMismatch_Rejected`._

### AC4: Invite acceptance — email/password fallback path

**Given** a `POST /api/auth/accept-invite` request with body `{ inviteToken, fullName?, password? }`,
**When** the request is processed,
**Then** the API performs:
1. **Token lookup:** `get_invite_by_token_hash(sha256(inviteToken))` via the SECURITY DEFINER function (Task 2). On `pgx.ErrNoRows` → 404 `INVITE_NOT_FOUND`. (Tokens are 32 random bytes from `crypto/rand`; the hash IS the access key per Story 1.5 W5 closure pattern.)
2. **Expiry check:** `invite.expires_at > clock.Now()`. Stale → 410 `INVITE_EXPIRED` + envelope details: `{ centerName, inviterEmail }` so the frontend can show the "Ask <inviter> to send a new one" UX from `ux-design-specification.md` table at line 580.
3. **Idempotency:** if `invite.accepted_at IS NOT NULL` → 409 `INVITE_ALREADY_ACCEPTED` + details `{ centerName }` so the frontend can redirect to login per UX line 581.
4. **Existing-account branch:** `existingUser, _ := GetUserByEmail(normalize(invite.email))`. If found:
   - If `existingUser.password_hash IS NULL` AND `password` is provided → reject 409 `PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER` (user must accept via Google).
   - Else open tx → `INSERT INTO center_members (user_id, center_id, role)` via `CreateCenterMember`. ON CONFLICT DO NOTHING (idempotent — user might already be in this center by another path). `UPDATE invites SET accepted_at = clock.Now() WHERE id = $1 AND accepted_at IS NULL` and assert `RowsAffected == 1` (race protection: two clients submitting same token concurrently — only one wins, the loser gets 409).
5. **New-account branch:** validate `fullName` (≥ 1, ≤ 200 runes, same as Register) and `password` (≥ 8 chars, ≤ 72 bytes, same as Register). Both required. Bcrypt outside the tx (H1). Then `CreateUser(email=invite.email, password_hash, full_name, google_id=NULL, email_verified=true)` (invite acceptance pre-verifies the email — they received the link in their inbox) + `CreateCenterMember` + `MarkInviteAccepted`.
6. **Issue session:** mint access JWT + refresh token (same as Login). The token claims include `center_id = invite.center_id` and `role = invite.role` so the user lands on their role-appropriate dashboard immediately (per FR-79).
7. **Post-commit audit:** `event = "invite.accepted"`, `entity_type = "invite"`, `entity_id = invite.id`, `Changes{ After: { centerId, role, method: "password" } }`.

**And** the response is `200 OK` envelope `{ data: { accessToken, user: { id, email, fullName, emailVerified }, center: { id, name }, role } }` + refresh-token cookie.

**Failure-path additions:**
- Body missing `fullName` or `password` on new-account branch → 422 `VALIDATION_FAILED`, `details.fields` lists missing fields.
- Existing user, body provides a `password` that differs from the user's current password → silently ignored (no password change as a side effect of invite acceptance). Document this in the AC; the frontend should not collect a password field for existing users.

_Pinned by ATDD (to be authored): `service/accept_invite_atdd_test.go::TestAcceptInvite_AC04_*`._

### AC5: Invite acceptance via OAuth — email match required, audit mismatch

**Given** a Google OAuth callback whose state payload carries `inviteTokenHash`,
**When** the callback runs after `resolveGoogleIdentity` (AC2 step 6),
**Then** the API calls `AcceptInviteInternal(ctx, user.id, inviteTokenHash, oauthProfileEmail)` which:
1. Loads the invite via the same SECURITY DEFINER function as AC4 step 1.
2. If `normalize(oauthProfileEmail) != normalize(invite.email)`:
   - Audit `event = "invite.email_mismatch"`, `entity_type = "invite"`, `entity_id = invite.id`, `Changes{ After: { invitedEmail: invite.email, oauthEmail: oauthProfileEmail, decision: "rejected" } }`.
   - Return `&service.EmailMismatchError{InvitedEmail: invite.email, OAuthEmail: oauthProfileEmail}`.
   - AC2 step 7 surfaces this to the user via redirect URL (NOT 200 with quiet skip — surface explicitly so user knows their invite was not consumed).
3. Else proceeds identically to AC4's existing-account branch: `CreateCenterMember` (ON CONFLICT DO NOTHING) + `MarkInviteAccepted` (guarded `WHERE accepted_at IS NULL`), audit `invite.accepted_via_oauth`.
4. If invite is expired or already accepted, return matching error so AC2 step 7 redirects with `?error=invite_expired` / `?error=invite_already_accepted` query params. Login still succeeds (the Google sign-in itself is independent of the invite outcome) but the invite is not consumed.

**Rationale for "login succeeds even if invite rejected":** the user's identity (Google account) is valid; they just can't join the specific invite. Forcing the entire OAuth flow to fail would leave them in a no-account state. Better to land them on the dashboard with a banner explaining the invite outcome — UX gets to choose the recovery (resend invite, contact owner).

### AC6: Force-logout API — Owner can invalidate a staff member's sessions

**Given** an authenticated `POST /api/admin/users/{userId}/force-logout` request from an Owner of center A,
**When** the request is processed by the middleware chain `RequestID → ClientIP → Logger → CORS → OriginCheck → globalRateLimit → ExtractTenant → requireRole("owner") → ErrorMapper → ForceLogoutHandler`,
**Then** the handler:
1. Parses `userId` from the path (`r.PathValue("userId")`) and validates it as a UUID. Malformed → 400 `INVALID_USER_ID`.
2. Calls `AuthService.ForceLogout(ctx, tc model.TenantContext, targetUserID uuid.UUID)`:
   - Open tx; `SET LOCAL app.current_tenant_id = tc.CenterID` via `set_config(...)` bind (per Story 1.5 AC13 / SEC-7 pattern from `auth_admin.go`).
   - **Tenant binding check (R1 + R6 invariant):** `GetCenterMemberByUserAndCenter(targetUserID, tc.CenterID)`. On `pgx.ErrNoRows` → return `&model.NotFoundError{Resource: "user", Code: "USER_NOT_FOUND"}` → handler emits **404** (NOT 403). Returning 403 would leak the existence of users in other tenants per the test-design-handoff acceptance pattern at line 79.
   - **Re-validate caller role from DB (SEC-1 / AC13 pattern):** `GetCenterMemberByUserAndCenter(tc.UserID, tc.CenterID)` → if `role != "owner"` → return `&service.ForbiddenError{Reason: "insufficient role"}`. (The middleware `requireRole("owner")` ran on the JWT claim — this is the EDGE-2 staleness defense.)
   - **Bulk-delete sessions:** `DELETE FROM refresh_tokens WHERE user_id = $1 RETURNING family_id`. This invalidates EVERY family — token reuse detection (AC8 from Story 1.5) is moot; we want every device dead.
   - Commit.
3. Post-commit audit: `event = "auth.force_logout"`, `entity_type = "user"`, `entity_id = targetUserID`, `Changes{ Before: { sessionsActive: <count> }, After: { sessionsActive: 0 } }`, and `actor_user_id = tc.UserID` (a new field on AuthAuditEntry — see Task 5 for the migration to add `actor_user_id text` if not already present).
4. Returns `200 OK` envelope `{ data: { forcedLogout: true, sessionsRevoked: <count> } }`.

**Documented limitation (FR-80 + EDGE-2):** the access tokens already issued to the target user remain valid for up to `AccessTokenTTL` (15 min). The target keeps their tail-of-session privileges until the access token's `exp` claim is reached. This is the EDGE-2 tradeoff already accepted by the team; the response intentionally does not invalidate JWT-bearer authority — only the refresh path. Document this in the API spec and the audit row carries `Changes.After.accessTokenTailWindowSeconds: <ceil(exp - now)>` so audit consumers can see the residual exposure window per event.

**Failure-path:**
- Target user same as caller (Owner force-logs out themselves) → permitted; tasks downstream UI to redirect caller to login.
- Target is also an Owner of the same center → permitted; an Owner can boot a co-Owner.
- Caller and target are the same user but caller is Admin → blocked at `requireRole("owner")` middleware (403).
- Target has zero active refresh tokens → still returns 200 with `sessionsRevoked: 0` (idempotent — Owner clicked "Force logout" on a user who hadn't logged in recently; success not error).

_Pinned by ATDD (to be authored): `service/force_logout_atdd_test.go::TestForceLogout_AC06_*` + adversarial cross-tenant test._

### AC7: Cross-tenant force-logout returns 404 — never 403 — to prevent existence leakage (R1 + R6)

**Given** an Owner of center A authenticated with a JWT carrying `center_id = A`,
**And** a `targetUserID` that belongs to center B but NOT to center A (no `center_members` row for `(targetUserID, A)`),
**When** the Owner POSTs `/api/admin/users/{targetUserID}/force-logout`,
**Then** the response is `404 Not Found` with envelope `{ error: { code: "USER_NOT_FOUND", message: "User not found.", requestId, details: null } }` — identical to the response for a genuinely non-existent UUID.

**And** no `refresh_tokens` row for center B's user is deleted (asserted by ATDD: post-call query returns the same row count as pre-call).

**And** an `auth_audit_logs` row is written with `event = "auth.force_logout_cross_tenant_attempt"`, `user_id = tc.UserID` (the caller), `Changes{ After: { targetUserId, callerCenterId: tc.CenterID, decision: "blocked_via_404" } }` so SOC can spot scanning patterns. **The audit row IS written — that's intentional — but the HTTP response does not change shape.**

_Pinned by ATDD (to be authored): `internal/test/force_logout_cross_tenant_test.go::TestForceLogout_AC07_CrossTenantReturns404`._

### AC8: OAuth state cookie carries all four attributes (R7) + SameSite=Lax compatibility check

**Given** the `oauth_state` cookie emitted by `GET /api/auth/google` (AC1) in any non-`development` environment,
**When** the response is inspected,
**Then** the cookie carries every one of:
- `HttpOnly` (true) — JS cannot read.
- `Secure` (true) — HTTPS only.
- `SameSite=Lax` — survives the cross-site GET callback from Google (Google redirects via `Location` header → top-level navigation → Lax cookies sent). Strict would break the callback entirely. None would weaken CSRF defense.
- `Domain=<COOKIE_DOMAIN>` — same value as refresh-token cookie. Lax cookies travel with the apex+subdomain pair.
- `Path=/api/auth` — narrower than `/` because no other endpoint uses this cookie; minimizes blast radius.
- `Max-Age=600` (10 min) — matches state TTL.

**And** the callback handler's cookie clearing (AC2 final step) emits the same attributes with `Max-Age=0` and an empty value — browsers discard.

**And** in `development` mode, `Domain` is empty (host-only on localhost) and `Secure=false` so the local dev OAuth round-trip works without HTTPS — same dev parity as Story 1.5 cookie config.

### AC9: OAuth state secret validated at startup — short / missing key prevents boot

**Given** the API server starting in any non-`development` environment,
**When** `config.Load()` returns,
**Then** `Config.Validate()` rejects startup when:
- `OAUTH_STATE_SECRET` is empty, OR
- `len([]byte(OAUTH_STATE_SECRET)) < 32` (HMAC-SHA256 minimum keylength).

**And** the server logs `slog.Error("invalid configuration", "error", "OAUTH_STATE_SECRET must be ≥ 32 bytes for HMAC-SHA256")` and exits non-zero.

**And** in `development` only, a short or missing key is allowed and emits `slog.Warn` (mirrors Story 1.5 AC15 dev behavior).

**Why a separate secret from JWT_SECRET:** signing keys with different purposes should rotate independently. A leaked JWT signing key compromises 15-min auth tokens; rotating it only impacts in-flight sessions. A leaked OAuth state secret only impacts the 10-min CSRF window. Sharing them tangles their rotation policies.

### AC10: Google API client construction validated + safe defaults

**Given** the API server starting in any non-`development` environment,
**When** `config.Load()` returns,
**Then** `Config.Validate()` rejects startup when `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REDIRECT_URL` is empty.

**And** the `GOOGLE_REDIRECT_URL` is parsed at startup; if it does not have scheme `https://` in non-dev (and matches `GOOGLE_REDIRECT_URL_PATH = "/api/auth/google/callback"`) → reject with `OAUTH_REDIRECT_URL_UNSAFE`. (Defense against accidental `http://` in prod.)

**And** the OAuth2 client uses `oauth2.NoContext`-free pattern (always thread request context) and explicitly sets `oauth2.Config.Endpoint = google.Endpoint` (NOT a hand-typed URL string — `golang.org/x/oauth2/google` provides the constants).

**And** the userinfo HTTP call has a 5-second timeout via `context.WithTimeout` (Google's userinfo endpoint p99 is ~400ms; 5s is generous but bounded). Hanging Google → 502 `OAUTH_USERINFO_TIMEOUT` redirect `?error=google_timeout`.

### Failure-Path Acceptance Criteria

**Given** a callback `?error=access_denied` (user clicked "Cancel" on Google's consent screen),
**When** the callback handler runs,
**Then** the cookie is cleared, response is `302 Found` to `${LOGIN_URL}?error=google_access_denied`, **no audit row** is written (this is a normal user action, not an attack — audit noise would drown actual signals).

**Given** a callback `?error=server_error` (Google's side fault),
**When** the handler runs,
**Then** the cookie is cleared, response is `302 Found` to `${LOGIN_URL}?error=google_server_error`, and a `slog.Warn` records the upstream error string.

**Given** a partial OAuth flow (user starts at `/api/auth/google`, never returns to `/callback`),
**When** the user re-initiates 10+ minutes later,
**Then** the old `oauth_state` cookie's `Max-Age=600` has expired; the new `GET /api/auth/google` overwrites the cookie cleanly. No stale-state pollution. (Validated by browser cookie discard semantics — no server-side state to clean.)

**Given** a force-logout where the target's `access_token` is still within its 15-minute validity window,
**When** the target makes API requests in that window,
**Then** the requests succeed against the JWT signature alone — refresh tokens are gone, so when the access token expires the user must re-login. **Documented limitation per FR-80 + EDGE-2; surfaces in `api.yaml` description and in the API admin documentation. Tradeoff accepted: cost of a token blocklist check on every request is unbounded; 15-min residual exposure is bounded.**

**Given** an `inviteToken` query param on `/api/auth/google` containing 4 KB of junk,
**When** the request is processed,
**Then** the value is capped at 256 chars and rejected with 400 `INVALID_INVITE_TOKEN` (token format is fixed-length base64url). Defense against parameter-stuffing attacks.

**Given** a callback `state` query parameter that does NOT match the `oauth_state` cookie byte-for-byte (e.g., attacker replaying a captured `state` from a different session),
**When** the callback handler runs,
**Then** even if the HMAC verifies (attacker knows the secret), the cookie-mismatch check (AC2 step 2) rejects. **Both** the cookie AND the state query param must match — this is the double-submit cookie pattern that defeats both XSS (HMAC defends) and CSRF (cookie defends).

**Given** an `Origin` header on the callback request,
**When** the OriginCheck middleware runs,
**Then** the callback is a `GET`, so OriginCheck passes through unconditionally (per AC12 from Story 1.5). The state cookie + HMAC do the CSRF work for callbacks.

## Tasks / Subtasks

> **TDD protocol (WF-8):** every AC above maps to a test that MUST exist on the branch before implementation begins. Author the ATDD red phase via `/bmad-tea AT 1-6-google-oauth-and-invite-acceptance-api` OR add the assertions inline as the first commit. The expected test file layout (mirroring Story 1.5's pattern):
>
> - `internal/service/google_oauth_atdd_test.go` (AC1, AC2, AC3, AC9, AC10)
> - `internal/service/accept_invite_atdd_test.go` (AC4)
> - `internal/service/accept_invite_oauth_atdd_test.go` (AC5)
> - `internal/service/force_logout_atdd_test.go` (AC6)
> - `internal/handler/google_oauth_handler_atdd_test.go` (AC1 redirect shape, AC8 cookie attrs, AC2 redirect targets)
> - `internal/handler/force_logout_handler_atdd_test.go` (AC6 envelope + status)
> - `internal/test/force_logout_cross_tenant_test.go` (AC7 — adversarial cross-tenant)
> - `internal/middleware/require_role_test.go` (NEW middleware, AC6 — see Task 8)
>
> **HARD ORDERING — schema migrations before ATDD tag removal:** invite token hash migration (Task 1) is a precondition for the `get_invite_by_token_hash` SECURITY DEFINER function (Task 2) the service code calls. Apply migrations + run `sqlc generate` BEFORE removing any `//go:build atdd_red_phase` tag, or you get `function does not exist` errors that look like service-layer bugs.

- [ ] **Task 1: Schema migrations** (AC: #1, #2, #4, #5, #6, #7)
  - [ ] Migration pair `migrations/20260607120000_hash_invite_token.up.sql` / `.down.sql`:
    ```sql
    -- up
    ALTER TABLE invites ADD COLUMN token_hash text;
    UPDATE invites SET token_hash = encode(sha256(token::bytea), 'hex'); -- backfill empty in MVP but keeps script idempotent
    ALTER TABLE invites ALTER COLUMN token_hash SET NOT NULL;
    CREATE UNIQUE INDEX idx_invites_token_hash ON invites (token_hash);
    DROP INDEX idx_invites_token;
    ALTER TABLE invites DROP COLUMN token;
    ```
    ```sql
    -- down
    ALTER TABLE invites ADD COLUMN token text;
    UPDATE invites SET token = '<rehydrate-impossible>' WHERE token IS NULL; -- one-way migration; document below
    ALTER TABLE invites ALTER COLUMN token SET NOT NULL;
    CREATE UNIQUE INDEX idx_invites_token ON invites (token);
    DROP INDEX idx_invites_token_hash;
    ALTER TABLE invites DROP COLUMN token_hash;
    ```
    **One-way warning:** the down migration cannot recover the original raw tokens — they were never stored after the hash migration ran. Down is provided for migration round-trip CI (R50) but production rollback would invalidate all in-flight invites. Document in `deferred-work.md`.
  - [ ] Migration pair `migrations/20260607120100_create_get_invite_by_token_hash_function.up.sql` / `.down.sql`:
    ```sql
    -- up
    CREATE OR REPLACE FUNCTION get_invite_by_token_hash(p_token_hash text)
    RETURNS TABLE (
        id          uuid,
        center_id   uuid,
        inviter_id  uuid,
        email       text,
        name        text,
        role        text,
        token_hash  text,
        expires_at  timestamptz,
        accepted_at timestamptz,
        created_at  timestamptz
    )
    LANGUAGE sql
    SECURITY DEFINER
    STABLE
    SET search_path = public
    AS $$
        SELECT id, center_id, inviter_id, email, name, role, token_hash,
               expires_at, accepted_at, created_at
        FROM invites
        WHERE token_hash = p_token_hash
        LIMIT 1;
    $$;
    -- Function runs as the migration role (superuser equivalent), bypassing RLS.
    -- This is intentional: invite acceptance is a PRE-TENANT operation — the
    -- caller doesn't know which center they're joining until after lookup.
    -- The token_hash IS the access boundary (32 random bytes from crypto/rand
    -- means brute-force is computationally infeasible).
    GRANT EXECUTE ON FUNCTION get_invite_by_token_hash(text) TO classlite_app;
    REVOKE EXECUTE ON FUNCTION get_invite_by_token_hash(text) FROM PUBLIC;
    ```
    ```sql
    -- down
    DROP FUNCTION IF EXISTS get_invite_by_token_hash(text);
    ```
  - [ ] Migration pair `migrations/20260607120200_add_auth_audit_actor.up.sql` / `.down.sql`:
    ```sql
    -- up
    ALTER TABLE auth_audit_logs ADD COLUMN actor_user_id uuid;
    -- actor_user_id distinguishes "the user this event is about" (user_id)
    -- from "the user who triggered it" (actor_user_id). For force-logout the
    -- subject is the target staff member; the actor is the Owner.
    CREATE INDEX idx_auth_audit_logs_actor_user_id
        ON auth_audit_logs (actor_user_id) WHERE actor_user_id IS NOT NULL;
    ```
    ```sql
    -- down
    DROP INDEX IF EXISTS idx_auth_audit_logs_actor_user_id;
    ALTER TABLE auth_audit_logs DROP COLUMN actor_user_id;
    ```
  - [ ] Run `scripts/migrate.sh up && scripts/migrate.sh down && scripts/migrate.sh up` against the local dev DB. Confirm clean round-trip (R50 invariant).
  - [ ] **CRITICAL Story-1.5 callsite patch — `internal/service/auth_admin.go::AdminInviteStaff`:** the existing INSERT writes the raw `token` column. After the Task 1 migration drops that column the file fails to compile. In the SAME commit as the migration, change the INSERT to:
    ```go
    rawToken, err := newPasswordResetToken() // reuse the 32-random-byte helper
    if err != nil { return fmt.Errorf("invite token: %w", err) }
    tokenHash := hex.EncodeToString(sha256.Sum256([]byte(rawToken))[:])
    now := s.clk.Now()
    if _, err := tx.Exec(ctx,
        `INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        centerUUID, userUUID, email, role, tokenHash, now.Add(inviteTTL),
    ); err != nil { ... }
    ```
    The raw token is currently discarded (the synthetic AdminInviteStaff hook from Story 1.5 doesn't send an email). When Epic 7's real invite-email flow lands, the raw token will be returned + emailed. Document the change in `auth_admin.go`'s godoc.



- [ ] **Task 2: New sqlc queries** (AC: #1, #2, #4, #5, #6)
  - [ ] `internal/store/queries/invites.sql` — REPLACE the existing `CreateInvite` / `GetInviteByToken` to use `token_hash`:
    ```sql
    -- name: CreateInvite :one
    INSERT INTO invites (center_id, inviter_id, email, name, role, token_hash, expires_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    RETURNING id, center_id, inviter_id, email, name, role, token_hash, expires_at, accepted_at, created_at;

    -- name: GetInviteByTokenHash :one
    -- This is a thin wrapper around the SECURITY DEFINER function — sqlc
    -- can't call functions directly, but a SELECT against a function is fine.
    SELECT id, center_id, inviter_id, email, name, role, token_hash,
           expires_at, accepted_at, created_at
    FROM get_invite_by_token_hash($1);

    -- name: MarkInviteAcceptedGuarded :execrows
    -- Returns affected row count so the service can detect "lost the
    -- accept race" — two clients submitting the same token concurrently.
    UPDATE invites SET accepted_at = now()
    WHERE id = $1 AND accepted_at IS NULL;
    ```
    Drop the legacy `GetInviteByToken` and `MarkInviteAccepted` queries — they reference the dropped column.
  - [ ] `internal/store/queries/users.sql` — ADD:
    ```sql
    -- name: LinkGoogleAccount :execrows
    -- The WHERE google_id IS NULL clause is the race guard: AC2 Branch B
    -- assumes exactly one linker wins; the loser sees 0 rows affected.
    UPDATE users
    SET google_id = $2, email_verified = true, avatar_url = COALESCE(avatar_url, $3), updated_at = now()
    WHERE id = $1 AND google_id IS NULL;
    ```
  - [ ] `internal/store/queries/refresh_tokens.sql` — ADD:
    ```sql
    -- name: DeleteRefreshTokensByUserReturningFamilies :many
    -- Used by ForceLogout (AC6). Returns family_id per deleted row so the
    -- service can count revoked sessions for the audit row. The bulk-delete
    -- shape is intentional — token reuse detection is moot when the Owner
    -- is explicitly burning everything.
    DELETE FROM refresh_tokens WHERE user_id = $1 RETURNING family_id;
    ```
    The existing `DeleteAllRefreshTokensForUser` (Story 1.3) does the same delete but doesn't return — keep it for the password-reset path (where the count isn't needed), introduce the RETURNING variant for force-logout.
  - [ ] Run `scripts/codegen.sh` (sqlc). Commit regenerated `internal/store/generated/*.sql.go`.

- [ ] **Task 3: New typed errors** (AC: #2, #4, #5, #6, #7, #9, #10)
  - [ ] Extend `internal/service/errors.go`:
    ```go
    // OAuth flow errors — all returned by AuthService.HandleGoogleCallback
    // and mapped by error_mapper.go to 302 redirects with ?error=<code>
    // query params (not the usual JSON envelope — OAuth callback is a
    // browser navigation, not an API call).
    type OAuthStateMissingError struct{}
    func (e *OAuthStateMissingError) Error() string { return "oauth state cookie missing" }

    type OAuthStateInvalidError struct{}
    func (e *OAuthStateInvalidError) Error() string { return "oauth state HMAC verification failed" }

    type OAuthStateExpiredError struct{}
    func (e *OAuthStateExpiredError) Error() string { return "oauth state TTL exceeded" }

    type OAuthExchangeError struct{ UpstreamErr string }
    func (e *OAuthExchangeError) Error() string { return "oauth code exchange failed: " + e.UpstreamErr }

    type OAuthUserinfoError struct{ Reason string }
    func (e *OAuthUserinfoError) Error() string { return "oauth userinfo: " + e.Reason }

    type OAuthEmailUnverifiedError struct{}
    func (e *OAuthEmailUnverifiedError) Error() string { return "google email not verified" }

    type OAuthTenantMismatchError struct{ RequestedHost, UserID string }
    func (e *OAuthTenantMismatchError) Error() string { return "oauth tenant binding failed" }

    type GoogleIDAlreadyLinkedError struct{}
    func (e *GoogleIDAlreadyLinkedError) Error() string { return "google_id already linked to another account" }

    // Invite acceptance errors
    type InviteNotFoundError struct{}
    func (e *InviteNotFoundError) Error() string { return "invite not found" }

    type InviteExpiredError struct{ CenterName, InviterEmail string }
    func (e *InviteExpiredError) Error() string { return "invite expired" }

    type InviteAlreadyAcceptedError struct{ CenterName string }
    func (e *InviteAlreadyAcceptedError) Error() string { return "invite already accepted" }

    type InviteEmailMismatchError struct{ InvitedEmail, OAuthEmail string }
    func (e *InviteEmailMismatchError) Error() string { return "oauth email differs from invited email" }

    type PasswordNotAllowedForOAuthUserError struct{}
    func (e *PasswordNotAllowedForOAuthUserError) Error() string { return "user has google-only account; password not accepted" }
    ```
  - [ ] Update `internal/middleware/error_mapper.go` to map each new error:
    - Invite errors → JSON envelope (these come from `POST /api/auth/accept-invite`):
      - `*InviteNotFoundError` → 404 `INVITE_NOT_FOUND`.
      - `*InviteExpiredError` → 410 `INVITE_EXPIRED` + `details: { centerName, inviterEmail }`.
      - `*InviteAlreadyAcceptedError` → 409 `INVITE_ALREADY_ACCEPTED` + `details: { centerName }`.
      - `*InviteEmailMismatchError` → 409 `INVITE_EMAIL_MISMATCH` + `details: { invitedEmail, oauthEmail }`.
      - `*PasswordNotAllowedForOAuthUserError` → 409 `PASSWORD_NOT_ALLOWED_FOR_OAUTH_USER`.
      - `*GoogleIDAlreadyLinkedError` → 409 `GOOGLE_ID_ALREADY_LINKED`.
    - OAuth callback errors do NOT go through `error_mapper.go` because the callback handler emits 302 redirects (not JSON). The callback handler maps errors directly to `${LOGIN_URL}?error=<code>` query strings — see Task 7 for the redirect helper.

- [ ] **Task 4: OAuth state cookie helper (HMAC-signed)** (AC: #1, #2, #8)
  - [ ] Create `internal/service/oauth_state.go`:
    ```go
    type OAuthStatePayload struct {
        Nonce            string `json:"nonce"`
        InviteTokenHash  string `json:"inviteTokenHash,omitempty"`
        RedirectTo       string `json:"redirectTo,omitempty"`
        IssuedAt         int64  `json:"issuedAt"` // unix seconds
    }

    type OAuthStateSigner interface {
        Sign(p OAuthStatePayload) (string, error)
        Verify(token string) (*OAuthStatePayload, error)
    }

    type hmacOAuthStateSigner struct {
        secret []byte
        clock  clock.Clock
    }

    func NewOAuthStateSigner(secret []byte) OAuthStateSigner
    func NewOAuthStateSignerWithClock(secret []byte, c clock.Clock) OAuthStateSigner
    ```
  - [ ] `Sign`: JSON-marshal payload → `payloadB64 := base64url.EncodeNoPad(jsonBytes)` → `sig := hmac.SHA256(secret).Write(payloadB64)` → return `payloadB64 + "." + base64url.EncodeNoPad(sig)`.
  - [ ] `Verify`: split on `.`, decode payload + sig, recompute HMAC, `subtle.ConstantTimeCompare` (defense against timing oracle on HMAC verification — never use `==` on cryptographic comparisons), JSON-unmarshal payload, assert `IssuedAt + 600 > clock.Now().Unix()` else return `*OAuthStateExpiredError`. Return `*OAuthStateInvalidError` on any other failure (don't differentiate failure modes externally — defense against probing).
  - [ ] Unit tests in `internal/service/oauth_state_test.go`:
    - Sign then verify happy path.
    - Tampered payload (mutate 1 byte) → `OAuthStateInvalidError`.
    - Wrong secret → `OAuthStateInvalidError`.
    - Expired (advance MockClock past 10 min) → `OAuthStateExpiredError`.
    - Empty token, missing dot, oversize token → all reject without panic.

- [ ] **Task 5: AuthAuditEntry — add `ActorUserID` field** (AC: #6, #7)
  - [ ] `internal/service/auth_audit.go`:
    - Add `ActorUserID uuid.UUID` to `AuthAuditEntry` struct. NULL → write NULL via `pgtype.UUID{Valid: false}` (same pattern as `UserID` nil-guard).
    - Update `pgAuthAuditLogger.Log` to write the new column. Mirror the existing `user_id` nil-guard logic.
  - [ ] `internal/store/queries/auth_audit_logs.sql` — update `InsertAuthAuditLog` to accept `actor_user_id` parameter.
  - [ ] Re-run `sqlc generate`. Commit regenerated file.
  - [ ] Existing audit callsites (Stories 1.3b–1.5) do NOT need updating — `actor_user_id` defaults to NULL when unset, which is correct for self-initiated events.

- [ ] **Task 6: AuthService — InitiateGoogleOAuth + HandleGoogleCallback** (AC: #1, #2, #3, #5, #9, #10)
  - [ ] Create `internal/service/auth_google.go` (separate file — `auth.go` is already at 642 lines).
  - [ ] Add `OAuthConfig` struct to AuthService dependencies:
    ```go
    type GoogleOAuthClient interface {
        AuthCodeURL(state string) string
        Exchange(ctx context.Context, code string) (*oauth2.Token, error)
        UserInfo(ctx context.Context, token *oauth2.Token) (*GoogleUserInfo, error)
    }

    type GoogleUserInfo struct {
        Sub            string // Google user ID
        Email          string
        EmailVerified  bool
        Name           string
        Picture        string // avatar URL, may be empty
    }

    // realGoogleOAuthClient wraps oauth2.Config + the userinfo HTTP call.
    // The interface seam means tests inject MockGoogleOAuthClient.
    ```
  - [ ] AuthService gains a new field `oauth GoogleOAuthClient` and `oauthState OAuthStateSigner`. Constructor extension:
    ```go
    func (s *AuthService) SetGoogleOAuth(client GoogleOAuthClient, state OAuthStateSigner) {
        s.oauth = client
        s.oauthState = state
    }
    ```
    Called from `main.go` after `NewAuthServiceWithClock`. Optional — leaving them nil means Google OAuth endpoints return 503 (Task 7 handler emits this).
  - [ ] `func (s *AuthService) InitiateGoogleOAuth(ctx context.Context, in InitiateGoogleOAuthInput) (*InitiateGoogleOAuthResult, error)`:
    - `InitiateGoogleOAuthInput { InviteToken string; RedirectTo string }`.
    - If `InviteToken != ""`: lookup via `GetInviteByTokenHash(sha256(InviteToken))` to verify existence; on miss return `*InviteNotFoundError`. Compute `inviteTokenHash := hex(sha256(InviteToken))` for the state payload.
    - If `RedirectTo != ""`: validate against allowlist (see AC1). Mismatch → drop silently (don't reject — UX should not break on a stale redirect_to).
    - Generate nonce: 32 random bytes → hex.
    - Build state payload, sign it, return.
    - `InitiateGoogleOAuthResult { SignedState, AuthCodeURL, ExpiresAt }`.
  - [ ] `func (s *AuthService) HandleGoogleCallback(ctx context.Context, in GoogleCallbackInput) (*GoogleCallbackResult, error)`:
    - Input: `{ Code, State, CookieState, RequestHost }`.
    - Order exactly per AC2 (state-cookie present → HMAC valid → TTL fresh → exchange → userinfo → resolve → tenant-bind → invite-bind → issue session).
    - Returns `*GoogleCallbackResult { User, AccessToken, RefreshToken, RefreshTTL, InviteAccepted bool, CenterID, Role }`.
    - The handler converts result → 302 redirect URL with appropriate query params (Task 7).
  - [ ] Internal helpers:
    - `resolveGoogleIdentity(ctx, tx, profile) (user, branch, error)` — encapsulates AC2 step 6 (A/B/C branches). Returns the branch enum so the caller can audit appropriately.
    - `assertTenantBinding(ctx, tx, user, requestHost) error` — AC3. Reads `APP_APEX_HOST` from a new field on AuthService (set via `SetAppApexHost`); compares request host vs apex; if subdomain, looks up center by slug and runs membership check. Returns `*OAuthTenantMismatchError` on miss.
    - **Center-by-slug lookup:** requires a new sqlc query `GetCenterByShortCode :one` (`centers.short_code` is unique per migration 20260601120000). Add to `centers.sql`.
  - [ ] **Profile fetch — implementation hint:** Google's `https://www.googleapis.com/oauth2/v3/userinfo` returns `{ sub, email, email_verified, name, picture }`. `oauth2.Token` has the bearer; build an `http.Client` from `oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))` and GET that URL with a 5-second `context.WithTimeout`. Decode into `GoogleUserInfo`. Return `*OAuthUserinfoError` on any non-2xx or decode failure.

- [ ] **Task 7: AuthHandler — Google init + callback + accept-invite + force-logout** (AC: #1, #2, #4, #5, #6, #7, #8)
  - [ ] In `internal/handler/auth_handler.go`, ADD methods. **The Google init/callback have non-standard error mapping (302 redirects, not JSON envelopes) so they bypass the canonical `middleware.ErrorMapper`**. Wire them as plain `func(w, r)` (not the `error`-returning shape) and call a new local helper `oauthRedirectErr(w, r, errCode string)` that writes the 302 + clears the cookie.
  - [ ] `func (h *AuthHandler) GoogleInit(w http.ResponseWriter, r *http.Request)`:
    - Read `inviteToken`, `redirectTo` from query string (capped at 256 chars each via `strings.TrimSpace` + length check).
    - Call `h.svc.InitiateGoogleOAuth(r.Context(), service.InitiateGoogleOAuthInput{InviteToken: ..., RedirectTo: ...})`.
    - On `*InviteNotFoundError` → 404 envelope (this one IS a JSON response — pre-Google, user hasn't redirected yet, so the frontend can show the error inline).
    - On success: `http.SetCookie(w, ...)` with the signed state, all four attributes from `h.cookie` (reuse `CookieConfig`), `Path = "/api/auth"`, `Max-Age = 600`. **Use the same `buildCookieHeader` pattern from Story 1.5** so leading-dot Domain survives.
    - `http.Redirect(w, r, result.AuthCodeURL, http.StatusFound)`.
  - [ ] `func (h *AuthHandler) GoogleCallback(w http.ResponseWriter, r *http.Request)`:
    - Read `code`, `state`, `error` from query string.
    - If `error == "access_denied"` → clear cookie, redirect `${LOGIN_URL}?error=google_access_denied`.
    - If `error != ""` → clear cookie, slog.Warn the upstream error, redirect `${LOGIN_URL}?error=google_server_error`.
    - Read `oauth_state` cookie. Absent → 302 `?error=csrf_invalid`.
    - Call `h.svc.HandleGoogleCallback(r.Context(), service.GoogleCallbackInput{Code, State, CookieState, RequestHost: r.Host})`.
    - Error mapping (each → clear cookie + 302):
      - `*OAuthStateInvalidError` / `*OAuthStateMissingError` → `?error=csrf_invalid`.
      - `*OAuthStateExpiredError` → `?error=csrf_expired`.
      - `*OAuthExchangeError` → `?error=google_exchange_failed`.
      - `*OAuthUserinfoError` → `?error=google_userinfo_failed`.
      - `*OAuthEmailUnverifiedError` → `?error=google_email_unverified`.
      - `*OAuthTenantMismatchError` → `?error=oauth_wrong_tenant&host=<urlencoded>`.
      - `*GoogleIDAlreadyLinkedError` → `?error=google_link_race`.
      - `*InviteExpiredError` → success login + `?error=invite_expired` (user is logged in; just couldn't consume the invite).
      - `*InviteAlreadyAcceptedError` → success login + `?error=invite_already_accepted`.
      - `*InviteEmailMismatchError` → success login + `?error=invite_email_mismatch&expectedEmail=...&googleEmail=...`.
    - On success: emit refresh cookie via `h.setRefreshCookie(w, &service.LoginResult{...})`. Redirect to `${APP_POST_LOGIN_URL}` (read from new `Config.AppPostLoginURL` field, default `http://localhost:5173/`). If `result.InviteAccepted` → append `?invited=true&center=<centerName>`.
  - [ ] `func (h *AuthHandler) AcceptInvite(w http.ResponseWriter, r *http.Request) error`:
    - Standard error-returning shape (this endpoint goes through `middleware.ErrorMapper`).
    - Decode body `{ inviteToken, fullName?, password? }` via `decodeAuthBody`.
    - Call `h.svc.AcceptInvite(ctx, input)`. Error types map per Task 3.
    - On success: `h.setRefreshCookie(w, &service.LoginResult{...})` + `WriteJSON 200` `{ accessToken, user, center: { id, name }, role }`.
  - [ ] `func (h *AdminHandler) ForceLogout(w http.ResponseWriter, r *http.Request) error`:
    - **NEW handler struct `AdminHandler` in `internal/handler/admin_handler.go`** — auth admin endpoints don't belong under `AuthHandler` because they require authentication (different middleware chain).
    - Read `userId` from `r.PathValue("userId")`. Parse UUID; on parse error → `model.ValidationError{Fields: [...]}`.
    - Read `model.TenantContext` from context via `middleware.TenantFromContext(r.Context())`. Absent → `&model.AuthRequiredError{}` (this is a defensive bug — `requireRole` middleware should have rejected first).
    - Call `h.svc.ForceLogout(r.Context(), tc, targetUUID)`.
    - On success: `WriteJSON 200` `{ forcedLogout: true, sessionsRevoked: <count> }`.

- [ ] **Task 8: New middleware — `RequireRole`** (AC: #6)
  - [ ] Create `internal/middleware/require_role.go`:
    ```go
    // RequireRole rejects requests whose ExtractTenant-populated context
    // does not carry one of the allowed roles. ExtractTenant must run first
    // (this middleware reads the DB-resolved role, not the JWT role — the
    // EDGE-2 staleness defense from Story 1.5 AC13).
    func RequireRole(allowed ...string) func(http.Handler) http.Handler
    ```
  - [ ] Implementation: read `model.TenantContext` from context, check `tc.Role` against `allowed` slice, 403 `INSUFFICIENT_ROLE` envelope on miss (inline write — pre-handler defense, doesn't depend on error_mapper).
  - [ ] Tests in `internal/middleware/require_role_test.go`: owner-passes, teacher-blocked, admin-blocked, no-tc-blocked-500 (programming error — surface loudly).

- [ ] **Task 9: AuthService — AcceptInvite + ForceLogout** (AC: #4, #5, #6)
  - [ ] Add to `internal/service/auth_google.go` (or new `auth_invite.go` / `auth_force_logout.go` if line count grows):
    - `func (s *AuthService) AcceptInvite(ctx context.Context, in AcceptInviteInput) (*AcceptInviteResult, error)`.
    - `func (s *AuthService) AcceptInviteInternal(ctx context.Context, userID uuid.UUID, inviteTokenHash, oauthEmail string) (*AcceptInviteResult, error)` — called from `HandleGoogleCallback` after profile resolution; differs from `AcceptInvite` only in that it skips the password-handling branch and adds the email-mismatch assertion.
    - `func (s *AuthService) ForceLogout(ctx context.Context, tc model.TenantContext, targetUserID uuid.UUID) (*ForceLogoutResult, error)`.
  - [ ] **`AcceptInvite` happy path:**
    1. Validate input (token non-empty, password/fullName per branch).
    2. Hash token: `hash := hex(sha256(in.Token))`.
    3. Lookup via `GetInviteByTokenHash(hash)` (calls the SECURITY DEFINER function — bypasses RLS).
    4. Check `accepted_at IS NULL` and `expires_at > clock.Now()`. Surface typed errors per AC4.
    5. Lookup user by `normalize(invite.email)`. Branch existing vs new.
    6. **Tx:** for new user, INSERT into `users` first (no RLS — global table). Then `SET LOCAL app.current_tenant_id = invite.center_id` (parameter-bind via `set_config(...)`) before the RLS-protected `INSERT INTO center_members`. Then `UPDATE invites SET accepted_at` (the SECURITY DEFINER function is read-only; the UPDATE goes via the normal sqlc-generated query under tenant context).
    7. Issue session (mint JWT + refresh row + post-commit audit).
  - [ ] **`ForceLogout` happy path:**
    1. Open tx.
    2. `SET LOCAL app.current_tenant_id = tc.CenterID` via parameter bind.
    3. Membership check via `GetCenterMemberByUserAndCenter(targetUserID, tc.CenterID)`. `pgx.ErrNoRows` → `*model.NotFoundError{Resource: "user", Code: "USER_NOT_FOUND"}` AND write cross-tenant audit row (`event = "auth.force_logout_cross_tenant_attempt"`) — AC7 invariant.
    4. Caller role re-validation: `GetCenterMemberByUserAndCenter(tc.UserID, tc.CenterID)`. Non-owner → `*ForbiddenError{Reason: "insufficient role"}`.
    5. `families, _ := q.DeleteRefreshTokensByUserReturningFamilies(targetUserID)` (RETURNING family_id from the bulk delete). Count rows for audit.
    6. Commit. Post-commit audit `event = "auth.force_logout"` with `ActorUserID = tc.UserID`.
    7. Return `ForceLogoutResult{ SessionsRevoked: len(families) }`.

- [ ] **Task 10: main.go wiring — Google OAuth config + new routes** (AC: #1, #2, #4, #6, #9, #10)
  - [ ] Add to `Config`:
    ```go
    GoogleClientID         string  // GOOGLE_CLIENT_ID
    GoogleClientSecret     string  // GOOGLE_CLIENT_SECRET
    GoogleRedirectURL      string  // GOOGLE_REDIRECT_URL — must be https in non-dev
    OAuthStateSecret       string  // OAUTH_STATE_SECRET — ≥ 32 bytes in non-dev
    AppApexHost            string  // APP_APEX_HOST — e.g. "my.classlite.app"; dev: "localhost:5173"
    AppPostLoginURL        string  // APP_POST_LOGIN_URL — dev: http://localhost:5173/
    AppLoginErrorURLBase   string  // APP_LOGIN_ERROR_URL_BASE — dev: http://localhost:5173/login
    ```
  - [ ] `Config.Validate()` rejects in non-dev when any of the above is empty AND when `OAuthStateSecret < 32` bytes AND when `GoogleRedirectURL` is not `https://` (AC10).
  - [ ] Construct OAuth pieces:
    ```go
    googleClient := service.NewGoogleOAuthClient(
        cfg.GoogleClientID, cfg.GoogleClientSecret, cfg.GoogleRedirectURL,
    )
    oauthState := service.NewOAuthStateSigner([]byte(cfg.OAuthStateSecret))
    authSvc.SetGoogleOAuth(googleClient, oauthState)
    authSvc.SetAppApexHost(cfg.AppApexHost)
    authSvc.SetAppPostLoginURL(cfg.AppPostLoginURL)
    authSvc.SetAppLoginErrorURLBase(cfg.AppLoginErrorURLBase)
    ```
  - [ ] Add 3 new auth routes + 1 admin route:
    ```go
    // Google OAuth — NO ErrorMapper (callback emits 302 redirects, not envelopes).
    // No per-route rate limit on init/callback; the global 200/min/IP suffices
    // (these are user-driven, low-frequency, browser-initiated).
    mux.HandleFunc("GET /api/auth/google", authHandler.GoogleInit)
    mux.HandleFunc("GET /api/auth/google/callback", authHandler.GoogleCallback)

    // Invite acceptance — rate-limited per-IP to prevent token enumeration.
    acceptInviteIPLimit := middleware.RateLimitByKey(
        "auth-accept-invite",
        rate.Every(time.Minute),
        10,
        middleware.IPKeyFn,
    )
    mux.Handle("POST /api/auth/accept-invite",
        acceptInviteIPLimit(http.HandlerFunc(middleware.ErrorMapper(authHandler.AcceptInvite))))

    // Force-logout — needs ExtractTenant + RequireRole.
    adminHandler := handler.NewAdminHandler(authSvc)
    forceLogoutChain := middleware.ExtractTenant(pool, authSvc.JWTSigner())(
        middleware.RequireRole("owner")(
            http.HandlerFunc(middleware.ErrorMapper(adminHandler.ForceLogout)),
        ),
    )
    mux.Handle("POST /api/admin/users/{userId}/force-logout", forceLogoutChain)
    ```
  - [ ] `authSvc.JWTSigner()` is a new exported accessor — needed because `main.go` already calls `SetJWTSigner` and now `ExtractTenant` needs the same instance. Add `func (s *AuthService) JWTSigner() JWTSigner { return s.jwt }`.
  - [ ] `pool` is the existing `*pgxpool.Pool` from `store.NewPool`. `pool` satisfies `service.AuthDB` (per Story 1.4 — already wired).

- [ ] **Task 11: Email template — invite email** (AC: out-of-band)
  - [ ] Extend `internal/service/email_templates.go` with `RenderInviteEmail(centerName, inviterName, role, acceptURL string) (subject, htmlBody string)`.
    - Subject: `"You're invited to join {centerName} on ClassLite"`.
    - Body: inline-styled HTML; centerName + inviterName + role in the body; CTA button → `acceptURL`.
    - English only (i18n deferred — Story 1.8/1.9c will swap to react-i18next on the frontend; backend templates stay EN per Story 1.4 deferred decision).
  - [ ] **Note:** this story does NOT introduce the invite send endpoint — that lands in Epic 7's staff-management story. We just provide the template so Epic 7 can `s.email.Send(...)` with a fully-rendered body. Add a CQ-2 `// why:` comment explaining the deliberate split.

- [ ] **Task 12: OpenAPI spec updates** (AC: cross-cutting)
  - [ ] `classlite-api/api.yaml` — ADD path entries:
    - `GET /api/auth/google` — query params: `inviteToken?`, `redirectTo?`. Success: 302 (`Location` header to Google). Errors: 404 `INVITE_NOT_FOUND`.
    - `GET /api/auth/google/callback` — query params: `code`, `state`, `error?`. Always returns 302 (success → app post-login URL; failure → login URL with `?error=<code>`). Document every error code from Task 7.
    - `POST /api/auth/accept-invite` — body: `AcceptInviteRequest`. Success: 200 `AcceptInviteResult`. Errors: 404, 410, 409 (multiple shapes), 422.
    - `POST /api/admin/users/{userId}/force-logout` — path: `userId` (uuid). Auth: bearer JWT, role=owner. Success: 200 `ForceLogoutResult`. Errors: 401, 403, 404, 422.
  - [ ] Add schemas: `AcceptInviteRequest`, `AcceptInviteResult`, `ForceLogoutResult`, `InviteExpiredDetails`, `InviteAlreadyAcceptedDetails`, `InviteEmailMismatchDetails`.
  - [ ] **Frontend codegen still deferred** (Story 1.8/1.9c will regenerate TS + Zod). Story 1.6 stays backend-only; spec changes ride along with frontend in 1.9c.

- [ ] **Task 13: Service unit tests** (AC: #1–#7, #9, #10)
  - [ ] `internal/service/auth_google_test.go`:
    - InitiateGoogleOAuth happy path (no invite, no redirectTo).
    - InitiateGoogleOAuth with valid invite → state carries inviteTokenHash.
    - InitiateGoogleOAuth with expired invite → `*InviteNotFoundError`.
    - InitiateGoogleOAuth with malicious redirectTo → silently dropped.
    - HandleGoogleCallback Branch A (`google_id` match) → existing user signed in, no link.
    - HandleGoogleCallback Branch B (email match, `google_id IS NULL`) → link succeeds, audit row.
    - HandleGoogleCallback Branch B race (two simultaneous linkers) → second sees 0 rows affected → `*GoogleIDAlreadyLinkedError`.
    - HandleGoogleCallback Branch C (no match) → new user created with `email_verified = true`.
    - HandleGoogleCallback with `email_verified = false` from Google → `*OAuthEmailUnverifiedError`.
    - HandleGoogleCallback with stale state (TTL exceeded) → `*OAuthStateExpiredError`.
    - HandleGoogleCallback with tampered state → `*OAuthStateInvalidError`.
    - HandleGoogleCallback on subdomain host with non-member user → `*OAuthTenantMismatchError`.
    - HandleGoogleCallback on apex host → tenant binding skipped.
  - [ ] `internal/service/accept_invite_test.go`:
    - AcceptInvite happy: new user + password → user created + membership + invite consumed.
    - AcceptInvite happy: existing user → membership added (no password change).
    - AcceptInvite token unknown → `*InviteNotFoundError`.
    - AcceptInvite token expired → `*InviteExpiredError` with details.
    - AcceptInvite token already accepted → `*InviteAlreadyAcceptedError`.
    - AcceptInvite race (concurrent submission of same token) → one wins, loser gets `*InviteAlreadyAcceptedError` (asserted by `MarkInviteAcceptedGuarded` RowsAffected check).
    - AcceptInvite for existing OAuth-only user with `password` provided → `*PasswordNotAllowedForOAuthUserError`.
  - [ ] `internal/service/force_logout_test.go`:
    - ForceLogout happy → all refresh tokens for target deleted, audit row written, sessions count returned.
    - ForceLogout target with 0 sessions → 200 with `sessionsRevoked: 0`.
    - ForceLogout cross-tenant → `*model.NotFoundError` (not `*ForbiddenError`) + cross-tenant audit row.
    - ForceLogout by Admin (re-validation finds Admin not Owner) → `*ForbiddenError`.
    - ForceLogout by demoted Owner (JWT says owner, DB row removed) → `*ForbiddenError`.
  - [ ] `internal/service/oauth_state_test.go` (per Task 4).

- [ ] **Task 14: Handler integration tests** (AC: #1, #2, #4, #5, #6, #7, #8)
  - [ ] `internal/handler/google_oauth_handler_test.go`:
    - `GET /api/auth/google` → 302 to Google + state cookie present.
    - State cookie has all four attributes per AC8 (mirror Story 1.5 AC10 test).
    - `GET /api/auth/google/callback` with mocked `GoogleOAuthClient` returning a happy profile → 302 to APP_POST_LOGIN_URL + refresh-token cookie set + state cookie cleared.
    - Callback with `?error=access_denied` → 302 to LOGIN_URL + `?error=google_access_denied`.
    - Callback with mismatched state cookie → 302 `?error=csrf_invalid`.
    - Callback with invite-bind email mismatch → 302 `?error=invite_email_mismatch` + refresh cookie still set (login succeeded).
  - [ ] `internal/handler/accept_invite_handler_test.go`:
    - 200 happy (new user, with password+fullName).
    - 200 happy (existing user, no password).
    - 404 unknown token.
    - 410 expired (details payload check).
    - 409 already accepted.
    - 422 missing fullName on new-user branch.
  - [ ] `internal/handler/force_logout_handler_test.go`:
    - 200 happy + refresh tokens gone.
    - 401 missing JWT.
    - 403 Teacher role JWT.
    - 404 cross-tenant target.
    - 400 malformed UUID in path.

- [ ] **Task 15: Adversarial tests** (AC: #2, #3, #6, #7)
  - [ ] Extend `internal/test/auth_adversarial_test.go`:
    - **OAuth state HMAC forgery:** craft a state with the correct shape but wrong secret → callback rejects with `csrf_invalid`.
    - **OAuth state replay across sessions:** capture state from session A, paste into session B (with B's cookie) → cookie-mismatch reject.
    - **Cross-tenant OAuth:** Owner A's Google account signs in via `tenant-b.classlite.app` — assert `?error=oauth_wrong_tenant`.
    - **Invite token enumeration:** post 1000 random tokens to `/api/auth/accept-invite` → all return `INVITE_NOT_FOUND` with comparable timing (no oracle on whether a token "almost matches"). Tolerance: ±50ms.
    - **Force-logout cross-tenant grid:** for every (centerA, centerB) pair, Owner of A attempting force-logout on user in B → 404 + audit row written + B's refresh tokens intact.
    - **Force-logout audit attribution:** verify `auth_audit_logs.actor_user_id` is set to the Owner, NOT the target.

- [ ] **Task 16: .env.example + config tests** (AC: #9, #10)
  - [ ] `.env.example` — populate the existing OAuth placeholders + add new ones:
    ```env
    # OAuth state HMAC signing secret (≥ 32 bytes in non-dev)
    OAUTH_STATE_SECRET=dev-oauth-state-secret-change-in-production-min-32

    # App URLs the OAuth flow redirects to
    APP_APEX_HOST=localhost:5173
    APP_POST_LOGIN_URL=http://localhost:5173/
    APP_LOGIN_ERROR_URL_BASE=http://localhost:5173/login
    ```
  - [ ] `internal/config/config_test.go` — add:
    - Non-dev with empty `GOOGLE_CLIENT_ID` rejected.
    - Non-dev with empty `OAUTH_STATE_SECRET` rejected.
    - Non-dev with short `OAUTH_STATE_SECRET` (< 32 bytes) rejected.
    - Non-dev with `GOOGLE_REDIRECT_URL=http://...` rejected.
    - Dev with empty Google secrets passes.

- [ ] **Task 17: Regression check + ATDD activation** (cross-cutting)
  - [ ] After every ATDD red phase test goes green, remove its `//go:build atdd_red_phase` build tag.
  - [ ] Run `go test ./...` from `classlite-api/`. All Story 1.1–1.5 tests must remain green.
  - [ ] Run `go test -race ./internal/service/...` against the concurrent-rotation test from Story 1.5 — ensure refresh-token race coverage didn't regress.
  - [ ] Run `scripts/migrate.sh up && scripts/migrate.sh down && scripts/migrate.sh up` against a clean DB to prove migration round-trip (R50 invariant).
  - [ ] Manual smoke test the OAuth round-trip end-to-end using a real Google Cloud OAuth client (dev consent screen): start at `http://localhost:8080/api/auth/google` → Google → callback → `http://localhost:5173/`. Confirm `oauth_state` cookie cleared, `refresh_token` cookie set, dashboard loads. **Document the OAuth client credentials needed in the dev README — operator (Ducdo) must create a Google Cloud project with the Authorized Redirect URI = `http://localhost:8080/api/auth/google/callback` before testing.**

## Dev Notes

### Project Context Reference

Read **`docs/project-context.md`** before implementing. Particularly:

| Rule | Relevance for this story |
|------|--------------------------|
| GO-1 | `invites` is RLS-protected; the SECURITY DEFINER function `get_invite_by_token_hash` is the ONE acceptable bypass (read-only, pre-tenant, token IS the access boundary). The INSERT path for `center_members` MUST `SET LOCAL app.current_tenant_id` first. |
| GO-2 | Every new error is a typed pointer struct in `internal/service/errors.go`. Mapper updated for invite errors (JSON envelope) but OAuth callback errors map to 302 redirects in the handler directly. |
| GO-4 | Post-commit audit + session-issue side effects use `context.WithoutCancel(ctx)` so OAuth callback's browser-navigation disconnect doesn't abort them. |
| GO-5 | Response DTOs use bare `json:"field"` tags. `accessToken` is always a string. `details` field on error envelope is `null` when absent (never omitted). |
| GFW-1 | `AuthHandler` AND the new `AdminHandler` are typed structs with pointer methods. `NewAdminHandler` returns a pointer. |
| GFW-2 | Every middleware factory (including the new `RequireRole`) returns `func(http.Handler) http.Handler`. |
| GFW-3 | `ExtractTenant` injects `model.TenantContext`. The new `ForceLogout` handler reads it via `middleware.TenantFromContext` — never reads headers directly. |
| GFW-5 | Every JSON response goes through `WriteJSON` / `WriteError`. The 302 redirects on the OAuth callback path are NOT JSON responses — they're browser navigations; documented exception. |
| SEC-1 | `ForceLogout` re-validates caller role from DB (AC6 step 4). The `RequireRole("owner")` middleware uses the DB-resolved role injected by `ExtractTenant` (Story 1.5 patch already does this) — it's the EDGE-2 staleness defense composed at the middleware layer. |
| SEC-3 | OAuth callback verifies tenant binding before issuing session (AC3) — explicit cross-subdomain assertion. |
| SEC-4 | Both the `oauth_state` cookie AND the existing `refresh_token` cookie use all four attributes from `CookieConfig` in non-dev. |
| SEC-5 | OAuth callback is a `GET` — Origin check passes through unconditionally; the state cookie + HMAC do the CSRF work. |
| SEC-7 | OAuth callback derives tenant from `Host` header (subdomain slug), NOT from any user-controlled body field. |
| SEC-10 | Per-route rate limits on `/api/auth/accept-invite` (10/min/IP, burst 10) — defends against invite token enumeration. OAuth init/callback rely on the global 200/min/IP (browser-driven, low frequency). |
| TEST-BE-1 | Adversarial tests cover OAuth state forgery, cross-tenant force-logout, invite enumeration timing. |
| TEST-BE-2 | Store tests stay on real DB via `test.SetupDB(t)` — never mock pgx. The `get_invite_by_token_hash` SECURITY DEFINER function is exercised by real DB calls, not unit-mocked. |
| TEST-BE-3 | Handler tests assert FULL `{data}` and `{error: {code, message, requestId, details}}` shapes on JSON endpoints. OAuth redirect endpoints assert exact `Location` header values. |
| TEST-BE-4 | Service tests inject `MockGoogleOAuthClient` (the new seam) — the underlying `oauth2` library is treated as untestable code (Google's servers are the integration test, run manually per Task 17). |
| CQ-2 | `// why:` comments for: SECURITY DEFINER rationale, double-submit cookie pattern, 5-second userinfo timeout, `subtle.ConstantTimeCompare` for HMAC, EDGE-2 tradeoff acceptance on force-logout. |
| CQ-3 | Constants: `OAuthStateTTL = 10 * time.Minute`, `OAuthCookieName = "oauth_state"`, `OAuthCookiePath = "/api/auth"`, `OAuthStateMinSecretBytes = 32`, `GoogleUserInfoURL = "https://www.googleapis.com/oauth2/v3/userinfo"`, `GoogleUserInfoTimeout = 5 * time.Second`, `MaxInviteTokenChars = 256`, `MaxRedirectToChars = 1024`, `InviteAcceptIPLimitBurst = 10`. |
| CQ-4 | No `mgr`, `oauth`, `req`, `resp` in variable names — use `authSvc`, `googleClient`, `oauthStateSigner`. Filename for the OAuth state helper: `oauth_state.go` (NOT `helpers.go` or `utils.go`). |
| WF-3 | New `.sql` files + new migration + sqlc-driven changes → MUST run `sqlc generate` → commit regenerated `internal/store/generated/*.go`. |
| WF-8 | Per-story testing protocol — author ATDD red tests for every score-≥6 AC BEFORE removing build tags. R6 (Google OAuth tenant binding) and R7 (cookie attrs) both score 6. |

### Refresh-Token Cookie Path vs OAuth State Cookie Path

The two cookies differ in `Path` attribute:

| Cookie | Path | Why |
|---|---|---|
| `refresh_token` | `/` | Sent on EVERY request so the browser auto-attaches it to `/api/auth/refresh` even when navigating elsewhere. |
| `oauth_state` | `/api/auth` | Narrowly scoped — only OAuth init + callback read it. Reduces blast radius if another endpoint accidentally inspects request cookies. |

Both share `Domain` from `CookieConfig`; both use `SameSite=Lax`, `HttpOnly`, `Secure` in non-dev.

### Google OAuth Flow Diagram

```
1. User clicks "Continue with Google" on frontend
   → Browser hits GET /api/auth/google?inviteToken=<optional>

2. Backend (AC1):
   - validate invite (if present) → 404 if dead
   - generate nonce (32 random bytes)
   - sign state payload { nonce, inviteTokenHash, redirectTo, issuedAt }
   - Set-Cookie: oauth_state=<signed>; HttpOnly; Secure; SameSite=Lax; Domain=...; Path=/api/auth; Max-Age=600
   - 302 Found Location: https://accounts.google.com/o/oauth2/v2/auth?client_id=...&state=<signed>&...

3. User completes consent on Google's domain

4. Google redirects browser to GET /api/auth/google/callback?code=<authcode>&state=<signed>

5. Backend (AC2):
   - read oauth_state cookie → MUST equal state query param byte-for-byte (double-submit)
   - HMAC verify → reject if tampered
   - TTL check → reject if > 10 min old
   - oauth2.Config.Exchange(code) → access_token
   - userinfo GET → { sub, email, email_verified, name, picture }
   - resolveGoogleIdentity → Branch A/B/C
   - if subdomain host: assertTenantBinding → AC3
   - if state.inviteTokenHash: AcceptInviteInternal → AC5
   - issue session: mint JWT + refresh row + Set-Cookie refresh_token + clear oauth_state cookie
   - 302 Found Location: APP_POST_LOGIN_URL (with ?invited=true&center=... if invite accepted)

6. Frontend renders dashboard.
```

### `invites` Table — RLS Bypass Justification

The `invites` table has `FORCE ROW LEVEL SECURITY` enabled with policies that filter by `current_tenant_id`. Token-based lookup needs to work WITHOUT a tenant context (the user doesn't know which center they're joining until after lookup).

**Why SECURITY DEFINER (chosen approach):**
- Preserves RLS for all other access paths (Owner listing invites, Admin creating invites).
- Makes the bypass explicit and auditable in `pg_proc`.
- Token IS the access boundary — 32 random bytes from `crypto/rand` means brute-force is computationally infeasible (2^256 keyspace, far beyond the keyspace of any realistic enumeration attack).
- Function is `STABLE`, `LANGUAGE sql` — query planner can inline it, no performance overhead vs a direct SELECT.

**Why NOT change RLS policy to allow public-token-lookup:**
- Adding `CREATE POLICY invites_token_lookup ON invites FOR SELECT USING (true)` defeats RLS entirely for SELECT.
- Even `USING (token_hash = current_setting('app.token_lookup_hash', true))` requires setting a session var, no better than calling a function.

**Why NOT use the migration-role pool for token lookup:**
- Two pools in the app means two connection pools to size, monitor, exhaust. Bad operationally.
- SECURITY DEFINER is the idiomatic Postgres solution.

### Account-Linking Race (AC2 Branch B)

Concurrent OAuth signins for the same email could try to link to the same user simultaneously:

```
T1: SELECT users WHERE email = 'foo@example.com' → google_id IS NULL
T2: SELECT users WHERE email = 'foo@example.com' → google_id IS NULL
T1: UPDATE users SET google_id = 'sub-A' WHERE id = X AND google_id IS NULL → 1 row
T2: UPDATE users SET google_id = 'sub-B' WHERE id = X AND google_id IS NULL → 0 rows
```

T2 sees `0 rows affected` → returns `*GoogleIDAlreadyLinkedError` → callback redirects `?error=google_link_race`. User retries (manual or via UI) → on retry, T2's profile fetches user by `google_id = 'sub-A'` (Branch A) — assuming T2's Google sign-in returned a DIFFERENT `sub` than T1's. If T1 and T2 are the SAME Google account, T2 sees Branch A on retry and signs in normally.

The race only matters in the rare case where two different Google accounts share the same email address (not possible under Google's contract: emails are unique). So practically this race is impossible — the guard is defense-in-depth against an extreme edge case (e.g., Google policy change, or merging Google Workspaces).

### Force-Logout Audit Attribution

The new `actor_user_id` column on `auth_audit_logs` is critical for force-logout: the `user_id` field describes the SUBJECT (whose sessions are revoked) while `actor_user_id` describes WHO did it. Without this, audit consumers (SOC tooling, security audits) can't tell whether a `auth.force_logout` event is self-initiated (rare) or Owner-initiated (the normal case).

Other event types where `actor_user_id` will eventually matter:
- `staff.role_changed` (Epic 7) — Owner promoted/demoted a teacher.
- `enrollment.transferred` (Epic 7) — Admin moved a student between classes.
- `billing.plan_changed` (Epic 9) — Owner upgraded/downgraded.

The column is added now (Story 1.6) so we don't have to retrofit each event type later.

### Architecture Compliance

- **GO-1:** `invites` and `center_members` are RLS — the AcceptInvite tx sets `app.current_tenant_id = invite.center_id` before `INSERT INTO center_members`. The token-lookup is SECURITY DEFINER (bypasses RLS, justified above). `users` and `refresh_tokens` and `auth_audit_logs` are global (pre-tenant) — no `SET LOCAL` needed for those writes.
- **GO-3 (strict layers):** handler → service → store. Middleware → service is permitted only for `ExtractTenant` (Story 1.5 precedent) and now `RequireRole` reads the already-injected `model.TenantContext` from context (no service call).
- **GFW-1 (typed handlers):** `AdminHandler` is a new struct with pointer methods. `NewAdminHandler` returns a pointer.
- **GFW-2 (`http.Handler`):** `RequireRole(...)` returns `func(http.Handler) http.Handler`.
- **GFW-3 (tenant context from middleware, not headers):** ForceLogout reads `tc` from context via `middleware.TenantFromContext`. The subdomain extraction in AC3 reads `r.Host` (header), which is the documented exception for tenant-resolution at the edge — same pattern Epic 2 will codify with its subdomain-routing story.
- **GFW-5 (envelope):** AcceptInvite + ForceLogout responses go through `WriteJSON`. The OAuth callback path emits 302 redirects — JSON envelope rule does not apply (HTTP redirect has no body shape).
- **GFW-6 (body restoration):** `AcceptInvite` doesn't need body-gating because the per-IP rate limit doesn't read the body. If we later add per-email rate-limiting (defense against invite-spam-followup), use the `emailKeyGate` pattern from Story 1.5.

### Library / Framework Requirements

| Library | Version | Why | Source |
|---|---|---|---|
| `golang.org/x/oauth2` | latest (v0.30+) | Google OAuth flow — `oauth2.Config.AuthCodeURL` + `oauth2.Config.Exchange`. NEW dep this story. | `go get golang.org/x/oauth2` |
| `golang.org/x/oauth2/google` | latest (matches parent) | `google.Endpoint` constant — never hand-type Google's auth/token URLs. | bundled with `oauth2` |
| `crypto/hmac` + `crypto/sha256` + `crypto/subtle` | stdlib | OAuth state HMAC signing + constant-time compare. | stdlib |
| `crypto/rand` | stdlib | Nonce generation. | stdlib (Story 1.4 pattern) |
| `encoding/base64` | stdlib | base64url (no-pad) state token encoding. | stdlib |
| `encoding/json` | stdlib | State payload serialization. | stdlib |

**No additional new libraries.** No `coreos/go-oidc` (overkill for our needs), no `markbates/goth` (heavyweight). The stdlib + `x/oauth2` combination is the project-context-mandated "Roll-your-own auth" with the Google-provided OAuth2 helper as a thin wrapper.

### Previous Story Intelligence

**From Story 1.5 (login + session):**
- `service.HashRefreshToken(raw)` exported — reusable pattern for hashing OAuth tokens too (but the Story 1.6 invite-hash uses raw `sha256` since the input is a single token, not a `family.random` composite).
- `handler.CookieConfig{Domain, Secure, SameSite}` exists — reuse for `oauth_state` cookie attrs.
- `handler.buildCookieHeader(name, value, cfg, maxAge)` exists with CRLF/`;` sanitization — reuse for the new state cookie write to preserve leading-dot Domain.
- `middleware.ExtractTenant(db, jwt)` exists — Story 1.5 patched it to populate `tc.Role` from the DB. Story 1.6 force-logout depends on this. **Do NOT regress: the DB role MUST overwrite the JWT role claim.**
- `middleware.NewCORS` + `middleware.NewOriginCheck` exist with wildcard support — no changes needed for Story 1.6 (no new origins).
- `service.AuthService.JWTSigner` field — needs to be accessible to `main.go` for wiring into `ExtractTenant`. Add `func (s *AuthService) JWTSigner() JWTSigner`.
- `service.NewAuthServiceWithClock` constructor pattern — extend with `SetGoogleOAuth(client, stateSigner)` and `SetAppApexHost(host)` setters rather than expanding the constructor signature (keeps Story 1.4/1.5 tests unbroken).
- `pgAuthAuditLogger.Log` writes the audit row. Story 1.6 adds `actor_user_id` to the entry struct + INSERT — touch the existing INSERT query carefully (it's also written from Stories 1.4 / 1.5 callsites; default nil → NULL).

**From Story 1.3 (auth schema):**
- `users.password_hash` IS nullable — OAuth-only users will have it NULL. Login MUST handle this (Story 1.5 already does — returns `InvalidCredentialsError` on missing hash; AC4 of Story 1.6 surfaces `PasswordNotAllowedForOAuthUserError` when an invite-acceptance flow tries to set a password on an OAuth-only user).
- `users.google_id` is `text` UNIQUE WHERE NOT NULL. The LinkGoogleAccount UPDATE relies on the partial unique index for race protection (two simultaneous links to different Google IDs would violate the unique constraint).
- `invites` has `accepted_at` nullable; Story 1.6 uses `accepted_at IS NULL` as the active-invite predicate.
- W4 from Story 1.3 deferred work ("token-based queries need to work outside tenant context") — closed by this story via the SECURITY DEFINER function.

**From Story 1.4 (registration + verification):**
- Email-verified-on-create pattern: Register sets `email_verified = false`, then VerifyEmail sets it true. **OAuth-created users (Branch C) and invite-accepted users skip this — they start `email_verified = true`.** Document the rationale: Google has already verified, invites are sent to a known address.

**From Story 1.5 retrospective (post-review patches):**
- The `actor_user_id` column motivation came partly from a review observation: force-logout would otherwise have audit ambiguity. We're addressing that during initial implementation rather than as a post-review patch.

### Git Intelligence (last 5 commits)

- `2b99097` (Merge to main): UX spec ships. The full UX spec at `_bmad-output/planning-artifacts/ux-design-specification.md` covers Auth screens including invite acceptance (`s00 AUTH-06`), Google OAuth (`s00 AUTH-01..AUTH-08`), and the "invite states" UX table (line 580 — expired/already-accepted/existing-account/email-mismatch). Reference this for error-redirect query string contracts.
- `1ba2aae` (Story 1.5): login + refresh + reset + JWT + CORS + Origin + ExtractTenant. The patterns established here — `CookieConfig`, `buildCookieHeader`, `clock.Clock`, pointer-typed errors, post-commit audit on `context.WithoutCancel`, `set_config(...)` parameter-bind for SET LOCAL — are the templates Story 1.6 follows.
- `20ddce1` (TEA test architecture): ATDD pattern, build-tag gating, MockClock seam. Story 1.6 follows the same red-then-green discipline.
- `45aa1c7` (Story 1.4): registration. `EmailRetryQueue`, `EmailSender` interface, `RenderVerificationEmail` template — reusable for Story 1.6's `RenderInviteEmail`.
- `e35db0d` (Story 1.3b): audit infrastructure. `pgAuthAuditLogger`, append-only via REVOKE UPDATE/DELETE — Story 1.6 extends this with the `actor_user_id` column without touching the append-only invariant.

### Latest Tech Information

- **`golang.org/x/oauth2` (v0.30+ as of 2026-06):** API is stable. `oauth2.Config{ClientID, ClientSecret, RedirectURL, Scopes, Endpoint: google.Endpoint}.AuthCodeURL(state)` and `.Exchange(ctx, code)` are the two methods used. The `oauth2.NoContext` constant is deprecated (use `context.Background()` or — better — thread the request context). `google.Endpoint` exposes `AuthURL` and `TokenURL` constants — never hand-type them (Google has redirected endpoints in the past during their v1→v2 transition).
- **`oauth2.NewClient`:** `httpClient := oauth2.NewClient(ctx, oauth2.StaticTokenSource(token))` wraps the bearer-token authorization. Use this for the userinfo HTTP call; do NOT add the `Authorization: Bearer ...` header manually (allocations + missed retries).
- **Google OAuth scopes:** `openid email profile` is the minimum set for sign-in. `https://www.googleapis.com/auth/calendar.events` would be needed for Google Meet integration (FR-8) — explicitly out of scope for Story 1.6 (lands in Story 2.5).
- **OAuth2 PKCE (RFC 7636):** PKCE is for public clients (mobile, SPA without backend). Our backend-mediated flow is a confidential client — `client_secret` provides equivalent protection. Do NOT add PKCE complexity to a confidential flow; if a future SPA-only OAuth path appears, it gets its own story.
- **`oauth2.Config.Endpoint = google.Endpoint`:** the `google` sub-package's constant. Importing `golang.org/x/oauth2/google` adds ~50 LOC of indirect deps (just the constant); no transitive bloat.
- **`crypto/subtle.ConstantTimeCompare`:** returns 1 if equal, 0 otherwise. Use ONLY for cryptographic comparisons (HMAC verification). Plain string equality elsewhere is fine.

### Manual Smoke Test Snippets

```bash
# Prerequisites:
# 1. Google Cloud Console: create OAuth 2.0 client with
#    Authorized redirect URI = http://localhost:8080/api/auth/google/callback
#    (operator-only step; document in dev README).
# 2. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, OAUTH_STATE_SECRET in .env.
# 3. API running on :8080, frontend stub on :5173.

# OAuth sign-in (full round-trip — manual; opens a browser):
open 'http://localhost:8080/api/auth/google'

# Invite token: first create an invite in the DB (replace center_id / inviter_id with seeded values):
psql -d classlite_dev -c "INSERT INTO invites (center_id, inviter_id, email, role, token_hash, expires_at) \
  VALUES ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', \
          'newteacher@example.com', 'teacher', encode(sha256('test-token-32-bytes'::bytea), 'hex'), \
          now() + interval '7 days');"

# Accept invite (new user path):
curl -sX POST -c cookies.txt http://localhost:8080/api/auth/accept-invite \
  -H 'Content-Type: application/json' \
  -d '{"inviteToken":"test-token-32-bytes","fullName":"New Teacher","password":"strongpass123"}' | jq

# Force-logout (requires owner JWT from a prior login):
TOKEN="<paste accessToken from login response>"
curl -sX POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:8080/api/admin/users/<target-uuid>/force-logout | jq
# Expect: { "data": { "forcedLogout": true, "sessionsRevoked": <N> } }

# Cross-tenant force-logout (Owner A targeting user in center B):
curl -sX POST -H "Authorization: Bearer $TOKEN_OWNER_A" \
  http://localhost:8080/api/admin/users/<user-in-center-B>/force-logout | jq
# Expect: 404 USER_NOT_FOUND (NOT 403)
```

### Project Structure Notes

The new files align cleanly with the architecture's directory layout:

| New / Updated | Path |
|---|---|
| NEW | `classlite-api/internal/service/auth_google.go` (InitiateGoogleOAuth + HandleGoogleCallback + GoogleOAuthClient impl) |
| NEW | `classlite-api/internal/service/auth_google_test.go` |
| NEW | `classlite-api/internal/service/auth_invite.go` (AcceptInvite + AcceptInviteInternal) |
| NEW | `classlite-api/internal/service/accept_invite_test.go` |
| NEW | `classlite-api/internal/service/auth_force_logout.go` (ForceLogout) |
| NEW | `classlite-api/internal/service/force_logout_test.go` |
| NEW | `classlite-api/internal/service/oauth_state.go` (HMAC signer) |
| NEW | `classlite-api/internal/service/oauth_state_test.go` |
| NEW | `classlite-api/internal/handler/admin_handler.go` (force-logout handler) |
| NEW | `classlite-api/internal/handler/admin_handler_test.go` |
| NEW | `classlite-api/internal/handler/google_oauth_handler_test.go` |
| NEW | `classlite-api/internal/handler/accept_invite_handler_test.go` |
| NEW | `classlite-api/internal/middleware/require_role.go` |
| NEW | `classlite-api/internal/middleware/require_role_test.go` |
| NEW | `classlite-api/internal/test/force_logout_cross_tenant_test.go` |
| NEW | `classlite-api/migrations/20260607120000_hash_invite_token.up.sql` |
| NEW | `classlite-api/migrations/20260607120000_hash_invite_token.down.sql` |
| NEW | `classlite-api/migrations/20260607120100_create_get_invite_by_token_hash_function.up.sql` |
| NEW | `classlite-api/migrations/20260607120100_create_get_invite_by_token_hash_function.down.sql` |
| NEW | `classlite-api/migrations/20260607120200_add_auth_audit_actor.up.sql` |
| NEW | `classlite-api/migrations/20260607120200_add_auth_audit_actor.down.sql` |
| UPDATE | `classlite-api/internal/service/auth.go` (add `oauth`, `oauthState`, `appApexHost`, `appPostLoginURL`, `appLoginErrorURLBase` fields + setters; export `JWTSigner()` accessor) |
| UPDATE | `classlite-api/internal/service/auth_audit.go` (add `ActorUserID` field on `AuthAuditEntry`) |
| UPDATE | `classlite-api/internal/service/errors.go` (12 new typed pointer errors) |
| UPDATE | `classlite-api/internal/service/email_templates.go` (add `RenderInviteEmail`) |
| UPDATE | `classlite-api/internal/handler/auth_handler.go` (add `GoogleInit`, `GoogleCallback`, `AcceptInvite` handlers) |
| UPDATE | `classlite-api/internal/handler/auth_handler_test.go` |
| UPDATE | `classlite-api/internal/middleware/error_mapper.go` (add invite-error branches; OAuth-error branches NOT added — those map at handler level) |
| UPDATE | `classlite-api/internal/middleware/error_mapper_test.go` |
| UPDATE | `classlite-api/internal/store/queries/invites.sql` (replace token-based queries with token_hash variants; add `MarkInviteAcceptedGuarded`) |
| UPDATE | `classlite-api/internal/store/queries/users.sql` (add `LinkGoogleAccount`) |
| UPDATE | `classlite-api/internal/store/queries/refresh_tokens.sql` (add `DeleteRefreshTokensByUserReturningFamilies`) |
| UPDATE | `classlite-api/internal/store/queries/auth_audit_logs.sql` (extend INSERT with `actor_user_id`) |
| UPDATE | `classlite-api/internal/store/queries/centers.sql` (add `GetCenterByShortCode`) |
| UPDATE | `classlite-api/cmd/api/main.go` (Google OAuth config wiring, 3+1 new routes, RequireRole middleware) |
| UPDATE | `classlite-api/internal/config/config.go` (5 new fields + validation) |
| UPDATE | `classlite-api/internal/config/config_test.go` |
| UPDATE | `classlite-api/internal/test/auth_adversarial_test.go` (OAuth state forgery, cross-tenant force-logout, invite enumeration) |
| UPDATE | `classlite-api/api.yaml` (4 new paths + 8 schemas) |
| UPDATE | `classlite-api/go.mod`, `go.sum` (golang.org/x/oauth2 + /google) |
| UPDATE | `.env.example` (OAUTH_STATE_SECRET, APP_APEX_HOST, APP_POST_LOGIN_URL, APP_LOGIN_ERROR_URL_BASE; populate Google placeholders) |
| UPDATE | `_bmad-output/implementation-artifacts/deferred-work.md` (Story 1.6 deferred items: invite-email send endpoint is Epic 7; multi-membership picker is Epic 2; refresh-token blocklist for instant force-logout deferred) |
| UPDATE | `_bmad-output/implementation-artifacts/sprint-status.yaml` (1-6 → ready-for-dev) |
| REGEN | `classlite-api/internal/store/generated/*.go` (after sqlc + migrations) |

No frontend files in this story. No `classlite-web/` or `classlite-landing/` changes. The frontend invite/OAuth UI lives in Stories 1.8 / 1.9c.

### Out of Scope (Explicit Non-Goals)

To prevent scope creep, this story does NOT introduce:

- **Invite-send endpoint or email dispatch** — `POST /api/admin/invites` for Owner/Admin to create+send invites lands in **Epic 7** (staff-management). Story 1.6 ships only the `RenderInviteEmail` template and the *acceptance* API. The existing synthetic `AdminInviteStaff` hook from Story 1.5 stays as the canonical role-revalidation guard; it writes an invite row but does not send.
- **Multi-membership center picker** — a user with memberships in multiple centers gets `center_id`/`role` auto-populated only when they have exactly one active `center_members` row (the Story 1.5 W2 deferred pattern). The proper picker UX lands in **Epic 2** (onboarding).
- **Auto-acceptance of pending invites on new OAuth signup** — a brand-new user who signs in with Google when there's a pending invite for that email does NOT automatically join. They must click the invite link. (Documented edge case: if AC2 Branch C fires + AC5 path fires AND emails match, the invite IS accepted because the user came in via the invite link's OAuth state. The "Google-first without invite link" path does not auto-consume.)
- **Subdomain routing infrastructure** — `r.Host` parsing in AC3 is a stub that reads `APP_APEX_HOST` env var. The actual subdomain → tenant mapping (with DNS, cert provisioning, slug validation) lands in **Epic 1C** alongside the frontend shell. AC3's contract is forward-compatible.
- **Refresh-token blocklist for instant force-logout** — bounded 15-min access-token tail is the accepted tradeoff per EDGE-2. A real blocklist (or short-TTL refresh-only model) is deferred to a security-hardening story post-launch if needed.
- **Google Workspace domain restriction** — `oauth2.SetAuthURLParam("hd", "<domain>")` could restrict sign-ins to a specific Google Workspace. Not needed for MVP (Vietnamese consumer Gmail dominates per UX research line 86); revisit if enterprise customers demand it.
- **OAuth profile sync (avatar, name updates)** — Branch A (existing Google user signs in again) currently does NOT refresh `avatar_url` or `full_name` from Google's profile. The user updates these via the profile-settings screen (Epic 9 story 9.4). Documented to prevent accidental "fix" by the dev.
- **PKCE for the OAuth flow** — confidential client (backend holds `client_secret`) makes PKCE redundant. Adding it would harm without helping. If a SPA-only OAuth path appears later (e.g., a native iOS app), it gets its own story.
- **Force-logout email notification to the target** — out of scope. Architectural pattern noted but no notification system is wired (Epic 10 owns inbox + notifications).

### References

- [Source: docs/project-context.md — GO-1, GO-2, GO-3, GO-4, GO-5, GFW-1, GFW-2, GFW-3, GFW-5, GFW-6, SEC-1, SEC-3, SEC-4, SEC-5, SEC-7, SEC-10, TEST-BE-1, TEST-BE-2, TEST-BE-3, TEST-BE-4, CQ-2, CQ-3, CQ-4, WF-3, WF-8, EDGE-2, EDGE-3]
- [Source: _bmad-output/planning-artifacts/epics/epic-01b-auth.md — Story 1.6]
- [Source: _bmad-output/planning-artifacts/architecture.md#authentication--security — Google OAuth (FR-81), Invite acceptance (FR-79), Force logout (FR-80), Auth API Endpoints]
- [Source: _bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-79, FR-80, FR-81]
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md — line 580 (invite states table), line 597 (invite via OAuth state-piggyback contract), line 87 ("invite acceptance as highest-value conversion node"), line 564 (sub-5-minute landing→first-grade target)]
- [Source: _bmad-output/test-artifacts/test-design/classlite_new-handoff.md — risk R6 (Google OAuth tenant binding), R7 (cookie attrs); auth stories acceptance patterns at lines 73–79; force-logout cross-tenant assertion at line 79]
- [Source: _bmad-output/test-artifacts/test-design/test-design-architecture.md — R6 + R7 + R1 risk register entries]
- [Source: _bmad-output/test-artifacts/test-design/test-design-qa.md — P0-326..345 auth security; P0-396..420 critical journey E2Es (J4 force-logout, J16 invite acceptance)]
- [Source: _bmad-output/implementation-artifacts/1-5-login-session-management-and-password-reset-api.md — CookieConfig, buildCookieHeader, clock.Clock injection, pointer-typed errors, post-commit audit pattern, SET LOCAL via set_config bind, ExtractTenant DB-resolved role injection]
- [Source: _bmad-output/implementation-artifacts/1-4-email-password-registration-and-email-verification-api.md — EmailRetryQueue, RenderVerificationEmail template structure, body-cap pattern]
- [Source: _bmad-output/implementation-artifacts/1-3-auth-database-schema-rls-and-security-testing.md — users/invites/refresh_tokens schema, RLS policies, W4 (token queries pre-tenant) closure plan]
- [Source: classlite-api/internal/service/auth.go — AuthService struct, NewAuthServiceWithClock, JWT signer wiring, ephemeralJWTSecret default]
- [Source: classlite-api/internal/service/auth_admin.go — canonical role-revalidation guard pattern + SET LOCAL parameter bind]
- [Source: classlite-api/internal/middleware/auth.go — ExtractTenant with DB-resolved role injection]
- [Source: classlite-api/internal/handler/auth_handler.go — CookieConfig, buildCookieHeader, decodeAuthBody pattern]
- [Source: classlite-api/migrations/20260601120000_create_auth_tables.up.sql — invites table schema with FORCE RLS]
- [Source: classlite-api/cmd/api/main.go — middleware chain order, rate-limit factories, emailKeyGate pattern]
- [Source: classlite-api/.env.example — pre-existing GOOGLE_CLIENT_ID/SECRET/REDIRECT_URL placeholders for this story]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
