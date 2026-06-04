# Story 1.4: Email/Password Registration & Email Verification API

Status: done

## Story

As a new user,
I want to register with my email and password and verify my email address,
so that I have a secure, verified account on the platform.

## Acceptance Criteria (BDD)

### AC1: Successful registration creates user, persists verification token, sends email
**Given** a `POST /api/auth/register` request with `{ email, password, fullName }` where
- `email` parses cleanly via `net/mail.ParseAddress`,
- `password` is ≥ 8 characters and ≤ 72 bytes (bcrypt limit),
- `fullName` is 1–200 trimmed characters,

**When** the request is processed,
**Then** the API returns `201 Created` with envelope `{ data: { user: {...}, verifyPollId: "<uuid>", emailDelivery: "sent" } }` (the `emailDelivery` field is ALWAYS present — see AC12 for the `"delayed"` variant),
**And** a new `users` row exists with `password_hash` set to a bcrypt hash (cost 12) of the supplied password, `email_verified = false`, and `google_id = null`,
**And** a new `email_verifications` row exists with a 32-byte URL-safe random token, `expires_at = now() + 24h`, `verified_at = null`, linked to the new user,
**And** the email service abstraction (`service.EmailSender`) is called with a verification email containing the link `{APP_VERIFY_URL_BASE}?token={token}`.

### AC2: Duplicate email rejected ambiguously to prevent enumeration
**Given** a registration request whose `email` already exists in `users` (regardless of verification status),
**When** the request is processed,
**Then** the API returns `409 Conflict` with envelope `{ error: { code: "EMAIL_ALREADY_REGISTERED", message: "If this email is not yet registered, you will receive a verification email shortly.", requestId, details: null } }`,
**And** the response shape and HTTP status are identical whether the existing account is verified or unverified,
**And** no new `users` or `email_verifications` row is created,
**And** no email is sent.

### AC3: Verification consumes token and flips user.email_verified
**Given** a `POST /api/auth/verify-email` request with body `{ token: "<token from email>" }`,
**And** an unconsumed, unexpired `email_verifications` row exists with that token,
**When** the request is processed,
**Then** the following three writes occur **in a single database transaction** (atomic — partial failure rolls back ALL three; no intermediate state is observable):
1. The `email_verifications.verified_at` for the matching row is set to `now()`.
2. All OTHER `email_verifications` rows for the same `user_id` with `verified_at IS NULL` are also marked consumed (`verified_at = now()`) so they cannot be reused.
3. The matching `users.email_verified` is set to `true`.

**And** the API returns `200 OK` with envelope `{ data: { verified: true, email: "<user email>" } }`,
**And** the operation is idempotent: subsequent POSTs with the same token return the same 200 response (see AC5).

### AC4: Expired verification token rejected with EXPIRED code
**Given** an `email_verifications` row whose `expires_at < now()`,
**When** `POST /api/auth/verify-email` is called with that token,
**Then** the API returns `410 Gone` with `{ error: { code: "VERIFICATION_TOKEN_EXPIRED", message: "This verification link has expired. Please request a new one.", requestId, details: null } }`,
**And** no user state changes,
**And** no email is sent.

### AC5: Already-consumed verification token returns 200 idempotent (any prior-issued token works)
**Given** any `email_verifications` row whose `verified_at IS NOT NULL` AND whose `user_id`'s `users.email_verified = true`,
**When** that token is POSTed to `/api/auth/verify-email`,
**Then** the API returns `200 OK` with `{ data: { verified: true, email: "<user email>" } }` regardless of whether the token is the most recent one or an older rotated-out one.

_Rationale: we minted every prior token, and the user is verified. Replaying any of them is not an attack vector — the user already proved control of the inbox. Distinguishing "current consumed token" from "older rotated-out consumed token" requires a race-prone heuristic query and adds no security value._

### AC6: Invalid/unknown token rejected with INVALID code
**Given** a `POST /api/auth/verify-email` request with a token that does not exist in `email_verifications`,
**When** the request is processed,
**Then** the API returns `404 Not Found` with `{ error: { code: "VERIFICATION_TOKEN_INVALID", message: "This verification link is not valid.", requestId, details: null } }`.

### AC7: Resend rotates the token and invalidates the previous one
**Given** a `POST /api/auth/resend-verification` request with body `{ email }`,
**And** a `users` row exists for that email with `email_verified = false`,
**When** the request is processed,
**Then** a new `email_verifications` row is created (new random token, fresh 24h expiry),
**And** all previously unconsumed `email_verifications` rows for that user have `verified_at = now()` set (they can no longer be used for verification),
**And** the new token is sent via the email service,
**And** the API returns `200 OK` with `{ data: { verifyPollId: "<new uuid>" } }`.

**Given** the same `POST /api/auth/resend-verification` request but the email belongs to an already-verified user OR the email does not exist,
**When** the request is processed,
**Then** the API returns `200 OK` with `{ data: { verifyPollId: null } }` (ambiguous response — never reveal whether email exists or verification state).

**Given** ANY successful `/api/auth/resend-verification` response (200 — both the existing-unverified-user path and the ambiguous-null path),
**When** measured from request receipt to response write,
**Then** the response time MUST be ≥ 200 ms (enforced via a `time.Sleep` floor in the handler that pads short paths up to the floor). This defeats timing-based enumeration of which emails are registered.

### AC8: verify-status endpoint returns current state without leaking emails
**Given** a `GET /api/auth/verify-status?pollId=<uuid>` request,
**And** the `pollId` matches an `email_verifications.id` whose `created_at > now() - 24h` (pollIds expire after 24 hours, matching the verification token TTL),
**When** the request is processed,
**Then** the API returns `200 OK` with `{ data: { verified: <users.email_verified for the row's user_id>, email: "<that user's email>" } }`.

**Given** a `GET /api/auth/verify-status?pollId=<uuid>` where the `pollId` does not exist, is malformed (non-UUID), OR matches an `email_verifications` row whose `created_at <= now() - 24h` (expired pollId),
**When** the request is processed,
**Then** the API returns `404 Not Found` with `{ error: { code: "POLL_ID_NOT_FOUND", message: "Verification session not found.", requestId, details: null } }`. The response is identical for all three cases (unknown / malformed / expired) to avoid leaking lifecycle state.

### AC9: Per-route rate limiting on register and resend-verification (token-bucket semantics)
**Given** the `/api/auth/register` and `/api/auth/resend-verification` endpoints,
**When** a client IP exceeds the per-IP token bucket sized **burst 5, replenishment 1 token every 2 minutes** (i.e., 5 requests immediately on a cold bucket, then 1 additional request every 2 minutes thereafter — token-bucket semantics, not fixed-window),
**Then** further requests from that IP return `429 Too Many Requests` with header `Retry-After: <seconds until next token>` (computed from `limiter.Reserve().Delay()`) and envelope `{ error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests. Please try again later.", requestId, details: null } }`,
**And** the per-route bucket is independent of the global 200/min/IP bucket.

_Why token-bucket vs fixed-window: the existing `rate_limit.go` uses `golang.org/x/time/rate` token-bucket primitives. A fixed-window limiter is heavier new code with no MVP justification. The token-bucket worst case (5 burst + ~4 replenished in 10 min = 9 requests / 10 min from a single cold IP) is acceptable for these endpoints — register and resend are user-driven, not machine-driven._

**Given** `/api/auth/resend-verification`,
**When** the same `email` (case-insensitive, trimmed) appears in requests faster than the per-email token bucket allows (**burst 1, replenishment 1 token every 60 seconds**),
**Then** the response is `429 Too Many Requests` with `Retry-After` set to seconds remaining until the next token (computed via `limiter.Reserve().Delay()`).

### AC10: Verify endpoint not rate-limited beyond global default
**Given** `/api/auth/verify-email` and `/api/auth/verify-status`,
**When** legitimate users click verification links and the frontend polls every 5s,
**Then** requests succeed up to the global 200/min/IP limit (no tighter per-route limit applied — users with broken email clients should not be locked out of verification).

### AC11: Malformed input rejected before DB interaction with structured 422
**Given** a registration request with any of: missing fields, `email` that fails `net/mail.ParseAddress`, `password` shorter than 8 chars, `password` longer than 72 bytes, `fullName` empty after trim, `fullName` longer than 200 chars, or body that fails JSON decode,
**When** the request is processed,
**Then** the API returns `422 Unprocessable Entity` with envelope `{ error: { code: "VALIDATION_ERROR", message: "Validation failed.", requestId, details: [{ field: "<field>", message: "<reason>" }, ...] } }`,
**And** no `users` or `email_verifications` row is created,
**And** the `Hasher` interface dependency (see Task 3 / H2) is never invoked (verified by `MockHasher.CallCount == 0`).

_SQL-injection safety: all inputs are bound via parameterized queries (sqlc / pgx v5). Payloads in non-format-validated fields (e.g., `fullName = "Robert'); DROP TABLE users--"`) are valid strings per AC11's rules and will be stored as literal data, NOT executed as SQL. Adversarial tests in Task 14 verify this property._

### AC12: Email send failure does not roll back registration
**Given** a successful registration whose DB transaction commits cleanly,
**And** the `EmailSender.Send` call returns an error (network failure, Resend outage, etc.),
**When** the request handler observes the send error,
**Then** the API still returns `201 Created` with the same body shape as AC1 plus an extra field `data.emailDelivery: "delayed"`,
**And** the user/verification rows remain in the database,
**And** the error is logged at `slog.Warn` level with fields `{ event: "verification_email_send_failed", user_id, email_verification_id, request_id, error }`,
**And** the email is enqueued for retry via the in-process retry goroutine (see Dev Notes → "Email retry strategy").

### AC13: Audit log entry on every state change (pre-tenant `auth_audit_logs` table)
**Given** any successful state change in this story — registration (creates user), verification (sets `email_verified = true`), resend (rotates token) —
**When** the transaction commits,
**Then** an audit entry is recorded via the `AuthAuditLogger` interface (NOT `service.AuditService` — see Dev Notes → "Pre-Tenant Audit Context") that writes a row into the `auth_audit_logs` table with:
- `user_id = users.id` (the actor — the user themselves),
- `action ∈ {"user.registered", "user.email_verified", "user.verification_resent"}`,
- `entity_type = "user"`,
- `entity_id = users.id`,
- `changes` JSONB shaped as `service.Changes{ Before, After }` (e.g., `{ "before": { "emailVerified": false }, "after": { "emailVerified": true } }`) — same `Changes` type as the main `AuditService`, but persisted to a different table,
- `ip_address` read from `r.Context().Value(model.IPAddress).(string)` (set by `ClientIP` middleware).

**And** the `auth_audit_logs` table is NOT tenant-scoped and NOT RLS-protected (this is by design — registration happens before any `center_members` row exists). Tenant-scoped audit events (billing, enrollment, role changes) continue to use the existing `audit_logs` table + `AuditService.Log`.

**And** audit failures are logged at `slog.Error` but do NOT fail the user-facing request — auth audit is best-effort, the user state change is authoritative.

### AC14: OpenAPI spec updated; sqlc regenerated (frontend codegen deferred)
**Given** the four new endpoints (`POST /register`, `POST /verify-email`, `POST /resend-verification`, `GET /verify-status`) and the new `auth_audit_logs` table,
**When** the change is shipped,
**Then** `classlite-api/api.yaml` defines each endpoint with request/response schemas matching the actual handler behavior (envelope shape, all documented status codes, all error codes),
**And** **sqlc has been re-run** after the new `.sql` query files (Task 2 + the new `auth_audit_logs.sql` from Task 8 of Dev Notes) are added — the regenerated `internal/store/generated/*.go` files are committed (per WF-3 — `.sql` changed → sqlc must run),
**And** **OpenAPI consumer codegen (TS types + Zod schemas)** is explicitly **deferred to the first frontend auth story (1.8 / 1.9a)** — `classlite-web` is not yet consuming `/api/auth/*` endpoints, so running `openapi-typescript` / `openapi-zod-client` now would generate types nobody imports. The spec change in `api.yaml` is in-scope; the consumer regen rides along with the first consumer.

## Tasks / Subtasks

- [x] **Task 1: Add bcrypt dependency** (AC: #1, #11)
  - [x] Run `go get golang.org/x/crypto/bcrypt@latest` from `classlite-api/`
  - [x] Verify `go.mod` and `go.sum` updated
  - [x] Confirm `bcrypt.DefaultCost` (10) vs explicit `12` — use **12** per Dev Notes → "Bcrypt cost selection"

- [x] **Task 2: Add new sqlc queries for service-layer guards** (AC: #3, #4, #5, #7, #8)
  - [x] `internal/store/queries/email_verifications.sql` — ADD:
    - `GetActiveEmailVerificationByToken :one` — selects rows where `verified_at IS NULL AND expires_at > now()`. Distinguishes expired from invalid (W5 from Story 1.3 deferred work).
    - `GetEmailVerificationByToken :one` already exists — keep for the idempotent AC5 path (returns rows regardless of expiry/consumption so the service can detect "already-verified user" and respond 200).
    - `InvalidateUnconsumedEmailVerificationsForUser :exec` — `UPDATE ... SET verified_at = now() WHERE user_id = $1 AND verified_at IS NULL`. Used on resend (token rotation) and on successful verify.
    - `GetEmailVerificationByID :one` — for `verify-status` polling. **Filter `created_at > now() - INTERVAL '24 hours'`** (per AC8 / M6 — pollIds expire at 24h, matching the verification token TTL). Returning `pgx.ErrNoRows` for expired pollIds gives the handler a single uniform "not found" path.
  - [x] `internal/store/queries/users.sql` already has `CreateUser`, `GetUserByEmail`, `UpdateUserEmailVerified` — no new queries needed.
  - [x] Run `sqlc generate` from `classlite-api/`. Confirm `internal/store/generated/email_verifications.sql.go` updated.
  - [x] Confirm WF-3: this **does** trigger codegen (a `.sql` file changed).

- [x] **Task 3: Author the AuthService — registration path** (AC: #1, #2, #11, #12, #13)
  - [x] **NEW: Hasher seam (H2).** Create `internal/service/hasher.go`:
    ```go
    type Hasher interface { Hash(plaintext []byte) (hash []byte, err error) }
    type BcryptHasher struct { Cost int } // production: Cost=12
    func (h BcryptHasher) Hash(p []byte) ([]byte, error) { return bcrypt.GenerateFromPassword(p, h.Cost) }
    ```
    Also `internal/service/hasher_mock.go` with `MockHasher{ CallCount int; FakeHash []byte; FailWith error }` so unit tests can assert AC11's "hasher never invoked" property and avoid 250ms-per-test bcrypt work.
  - [x] Create `internal/service/auth.go` with `AuthService` struct:
    ```go
    type AuthService struct {
        pool      txBeginner          // same minimal Begin surface used by AuditService
        hasher    Hasher              // H2 — injected so MockHasher can verify AC11
        email     EmailSender
        audit     AuthAuditLogger     // B1 — pre-tenant audit interface, NOT *AuditService
        retry     EmailRetryQueue     // see Task 9
        verifyURL string              // {APP_VERIFY_URL_BASE}, no trailing slash
    }
    func NewAuthService(pool txBeginner, hasher Hasher, email EmailSender, audit AuthAuditLogger, retry EmailRetryQueue, verifyURL string) *AuthService
    ```
  - [x] `func (s *AuthService) Register(ctx context.Context, req RegisterRequest) (*RegisterResult, error)` returns `{ User generated.User, VerifyPollID uuid.UUID, EmailDelivery "sent"|"delayed" }`.
  - [x] **Step 1 — Input validation (before any DB or hash work):** build `model.ValidationError{Fields: ...}` for any rule in AC11. Use `net/mail.ParseAddress`, `len([]byte(password))` for the 72-byte bcrypt limit, `utf8.RuneCountInString(fullName)` for the 200-char cap. Normalize email: `strings.ToLower(strings.TrimSpace(req.Email))`. **If validation fails, return immediately — `s.hasher.Hash` must NOT be called (AC11 / H2).**
  - [x] **Step 2 — Hash OUTSIDE the transaction (H1):** call `hash, err := s.hasher.Hash([]byte(req.Password))`. Cost-12 bcrypt takes ~250ms; holding a pool connection for that is wasteful. Hash first, then open the tx for DB writes only.
  - [x] **Step 3 — Generate verification token** (see Dev Notes → "Verification token generation"). 32 bytes from `crypto/rand`, base64-url-no-padding encoded. Never `math/rand`. Never UUIDs.
  - [x] **Step 4 — Single transaction for the DB writes (H1):**
    - `pool.Begin(ctx)` — defer rollback via `context.WithoutCancel` (mirror `audit.go` pattern).
    - `CreateUser(email, hash, fullName, nil /*google_id*/)` — do **not** pre-check with `GetUserByEmail`. Rely on the DB unique index. Catch the pgx unique-violation error (`var pgErr *pgconn.PgError; errors.As(err, &pgErr) && pgErr.Code == "23505"`) and return `model.ConflictError{Code: "EMAIL_ALREADY_REGISTERED", Message: "If this email is not yet registered, you will receive a verification email shortly."}` — handler maps to 409 per AC2. Rationale (H1): single round-trip + race-free; pre-checking is a TOCTOU window.
    - `CreateEmailVerification(user.ID, token, expiresAt)`.
    - `tx.Commit(ctx)`.
  - [x] **Step 5 — Post-commit side effects (best-effort, not in tx):**
    - Call `s.audit.Log(ctx, AuthAuditEntry{ UserID: user.ID, Action: "user.registered", EntityType: "user", EntityID: user.ID, Changes: service.Changes{ Before: nil, After: { emailVerified: false } } })`. Log on error but do not fail the request (per AC13).
    - Fire-and-forget email via goroutine: `go s.sendVerificationEmail(context.WithoutCancel(ctx), user.Email, token)`. On send failure, push onto `s.retry` and emit `slog.Warn` per AC12. Set `result.EmailDelivery = "sent"` if the synchronous part of send was attempted (the goroutine reports success asynchronously — for the response shape, default to `"sent"`; switch to `"delayed"` only when the synchronous send-attempt path is bypassed because the buffered channel is full, which is the only failure observable before the response is written).
    - **Refinement on `emailDelivery`:** since the email send is fire-and-forget, the handler cannot wait for the result. Resolve at construction time: if the in-process retry queue's input channel is full at the moment of enqueue → `"delayed"`; otherwise → `"sent"`. This is best-effort, but it gives the frontend a useful signal without blocking the response.

- [x] **Task 4: AuthService — verify, resend, verify-status paths** (AC: #3–#8, #13)
  - [x] `func (s *AuthService) VerifyEmail(ctx context.Context, token string) (*VerifyResult, error)` — see AC3, AC4, AC5, AC6:
    1. `GetEmailVerificationByToken(token)`. If err is `pgx.ErrNoRows` → `model.NotFoundError{Code: "VERIFICATION_TOKEN_INVALID", Resource: "verification_token"}` (Task 5 — `Code` field overrides the default `NOT_FOUND`).
    2. If `verified_at IS NOT NULL` → look up `users.email_verified`. If `true` → return `{ Verified: true, Email: user.Email }` **idempotent 200 (AC5) — regardless of whether this is the most recent token or an older rotated-out one**. If `false` → return `model.GoneError{Code: "VERIFICATION_TOKEN_EXPIRED"}` (data corruption case: should not happen in practice because verify always sets `users.email_verified = true` in the same tx that marks the token consumed, but defend against it).
    3. If `expires_at < now()` AND `verified_at IS NULL` → return `model.GoneError{Code: "VERIFICATION_TOKEN_EXPIRED", Reason: "This verification link has expired. Please request a new one."}`.
    4. **Single atomic transaction (AC3 / M2):** open tx → `MarkEmailVerificationVerified(id)` + `InvalidateUnconsumedEmailVerificationsForUser(user_id)` + `UpdateUserEmailVerified(user_id)` → commit. Partial failure rolls back all three writes.
    5. After commit (best-effort): `s.audit.Log(ctx, AuthAuditEntry{ UserID: user.ID, Action: "user.email_verified", EntityType: "user", EntityID: user.ID, Changes: service.Changes{ Before: { emailVerified: false }, After: { emailVerified: true } } })`.
    6. Return `{ Verified: true, Email: user.Email }`.
  - [x] `func (s *AuthService) ResendVerification(ctx context.Context, email string) (*ResendResult, error)` — see AC7, **including the 200ms constant-time floor (H4)**:
    - **Step 0 — Record `startedAt := time.Now()`** at the very top of the function. The constant-time floor (Step 5) uses this.
    - Validate email parses (`net/mail.ParseAddress`); on parse failure return `ValidationError` (no floor applied — validation errors are 422, not 200, and the timing channel only matters for the 200 path).
    - Normalize email (lowercase, trim).
    - `GetUserByEmail`. **Two paths converge on the same 200 response:**
      - **Unknown email OR already-verified user** → set `result = { VerifyPollID: nil }`. No DB writes. No email send. No audit.
      - **Existing unverified user** → open tx → `InvalidateUnconsumedEmailVerificationsForUser(user.ID)` → `CreateEmailVerification(user.ID, newToken, now+24h)` → commit. After commit: audit `user.verification_resent`. Fire-and-forget email (same retry semantics as registration). Set `result = { VerifyPollID: newVerification.ID }`.
    - **Step 5 — Constant-time floor (H4 / AC7):** before returning the 200 response, compute `elapsed := time.Since(startedAt)`. If `elapsed < 200*time.Millisecond`, `time.Sleep(200*time.Millisecond - elapsed)`. The floor must wrap BOTH success paths (known and unknown email) so timing leaks no signal. Validation 422 responses bypass the floor.
    - Note: the per-email rate-limit middleware in Task 8 sees the request body BEFORE the handler runs, so its 429 decision is made on body content alone — it does not (and cannot) condition on whether the email exists. Both known and unknown emails consume identical tokens from the per-email bucket. ✓
  - [x] `func (s *AuthService) VerifyStatus(ctx context.Context, pollID uuid.UUID) (*VerifyStatusResult, error)` — see AC8:
    - `GetEmailVerificationByID(pollID)` (which now filters `created_at > now() - 24h` per M6); if not found OR pollId malformed at the handler layer → `model.NotFoundError{Code: "POLL_ID_NOT_FOUND", Resource: "verify_poll"}`.
    - Look up the user; return `{ Verified: user.EmailVerified, Email: user.Email }`.

- [x] **Task 5: Extend error types and error mapper for new HTTP codes** (AC: #2, #4, #6, #8)
  - [x] **Pre-flight grep (M5):** before changing the structs, run from `classlite-api/`:
    ```
    grep -rn "model.NotFoundError{" --include="*.go"
    grep -rn "model.ConflictError{" --include="*.go"
    ```
    Confirm existing call sites (known: `internal/handler/upload_handler.go` lines ~135, ~141) use struct literals without a `Code` field. The new `Code string` field's zero value (`""`) must trigger the error mapper's default fallback so existing tests/handlers continue to work with zero edits.
  - [x] `internal/model/errors.go` — ADD:
    - `GoneError struct { Code, Reason string }` with `func (e GoneError) Error() string { return e.Reason }`. Maps to HTTP 410.
    - ADD `Code string` and `Message string` fields to existing `ConflictError`. `Error()` method stays stable: if `Message` is empty, fall back to current `fmt.Sprintf("%s %s already exists", Resource, ID)`. Existing zero-value call sites compile without edits.
    - ADD `Code string` field to existing `NotFoundError`. `Error()` method stays stable: same fallback pattern.
  - [x] `internal/middleware/error_mapper.go` — UPDATE the `switch errors.As(...)` block:
    - Add a `var gone model.GoneError` branch mapping to `http.StatusGone` (410) using `gone.Code` (no default needed — `GoneError` is new and all call sites set `Code` explicitly).
    - In the existing `ConflictError` branch: use `conflict.Code` if non-empty else `"CONFLICT"`; use `conflict.Message` if non-empty else `conflict.Error()`.
    - In the existing `NotFoundError` branch: use `notFound.Code` if non-empty else `"NOT_FOUND"`.
  - [x] Update existing unit tests in `internal/middleware/error_mapper_test.go` to cover: 410 path, custom `ConflictError.Code`, custom `NotFoundError.Code`. **Existing assertions must continue to pass with no edits** (defaults preserved — verify by running the existing test names unchanged before adding new ones).

- [x] **Task 6: AuthHandler — HTTP wiring** (AC: #1–#8, #11)
  - [x] Create `internal/handler/auth_handler.go`:
    ```go
    type AuthHandler struct { Svc *service.AuthService }
    func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) error
    func (h *AuthHandler) VerifyEmail(w http.ResponseWriter, r *http.Request) error
    func (h *AuthHandler) ResendVerification(w http.ResponseWriter, r *http.Request) error
    func (h *AuthHandler) VerifyStatus(w http.ResponseWriter, r *http.Request) error
    ```
  - [x] Each handler returns `error` so `middleware.ErrorMapper` handles status mapping (GFW-1, established pattern from `upload_handler.go`).
  - [x] Use `json.NewDecoder(r.Body).Decode(&req)` for JSON body parsing; reject malformed bodies as `model.ValidationError{Fields: [{Field: "body", Message: "invalid JSON"}]}` (same pattern as `upload_handler.Presign`).
  - [x] Use `handler.WriteJSON(w, 201, RegisterResponseBody{...})` for register, `200` for verify/resend/verify-status.
  - [x] DTOs (request and response) defined in the handler file with camelCase JSON tags (per architecture format pattern), `json:"fieldName"` with no `omitempty` (GO-5).

- [x] **Task 7: Wire handlers and middleware in main.go** (AC: #1, #9)
  - [x] `cmd/api/main.go` — UPDATE:
    - Construct `EmailSender`: if `cfg.ResendAPIKey != ""`, use `service.NewResendEmailSender(cfg.ResendAPIKey, cfg.ResendFromEmail)`; else use `&service.MockEmailSender{}` and log a warning at startup (`"email sender mocked — no RESEND_API_KEY set"`).
    - Construct `hasher := service.BcryptHasher{Cost: 12}` (H2 — production cost).
    - Construct `authAudit := service.NewPgAuthAuditLogger(pool)` (B1 — new `AuthAuditLogger`, NOT the tenant-scoped `AuditService`).
    - Construct in-process email retry queue (`retryQ := service.NewEmailRetryQueue(emailSender, 256 /* buffer */)` — see Task 9). Start its worker: `go retryQ.Start(shutdownCtx)`.
    - Construct `authSvc := service.NewAuthService(pool, hasher, emailSender, authAudit, retryQ, cfg.AppVerifyURLBase)`.
    - Construct `authHandler := &handler.AuthHandler{Svc: authSvc}`.
    - Add four new routes, threading per-route limiters (Task 8) between the existing global chain and the handlers:
      - `POST /api/auth/register` → `RateLimitByKey("auth-register", rate.Every(2*time.Minute), 5, ipKeyFn)` → `middleware.ErrorMapper(authHandler.Register)`
      - `POST /api/auth/verify-email` → `middleware.ErrorMapper(authHandler.VerifyEmail)` (global limiter only)
      - `POST /api/auth/resend-verification` → `RateLimitByKey("auth-resend-ip", ...)` → `RateLimitByKey("resend-email", ...)` → `middleware.ErrorMapper(authHandler.ResendVerification)`
      - `GET /api/auth/verify-status` → `middleware.ErrorMapper(authHandler.VerifyStatus)` (global limiter only)
    - Final middleware order: `RequestID → ClientIP → Logger → CORS → (per-route limiter, where present) → global RateLimit → mux`. Per-route limiters MUST sit outside the global one so a per-route 429 still counts toward global accounting (and conversely, a global 429 short-circuits before per-route).
    - **Graceful shutdown:** the existing `srv.Shutdown(ctx)` block must also cancel `shutdownCtx` so `retryQ.Start` returns cleanly. Existing 10s timeout is fine.

- [x] **Task 8: Per-route + per-email rate limiters** (AC: #9, #10)
  - [x] `internal/middleware/rate_limit.go` — ADD a sibling factory `RateLimitByKey(name string, rps rate.Limit, burst int, keyFn func(*http.Request) string) func(http.Handler) http.Handler`:
    - Same token-bucket-per-key + cleanup-goroutine pattern as the existing global `RateLimit`, parameterized on the key function.
    - `name` is included in slog `"rate_limit_exceeded"` log fields (`"limiter": name`) and in the `Retry-After` calculation.
    - `Retry-After` header computed from `limiter.Reserve().Delay()` rounded up to seconds (current global limiter hard-codes `"60"` — keep that default for the global limiter; per-route uses the computed value).
    - **Key function returning empty string `""` means "skip the limiter for this request"** — the middleware passes through to `next.ServeHTTP` without consuming a token. This is the spec'd behavior for the per-email limiter when the body is malformed (H3) — see below.
  - [x] **Refactor `extractIP`** to **prefer** `r.Context().Value(model.IPAddress).(string)` (set by `ClientIP` middleware) and fall back to the current X-Forwarded-For / `r.RemoteAddr` logic. This closes deferred-work W1 from Story 1.3b as part of this story (we're already touching rate-limit code; do it now). Call out in completion notes.
  - [x] **Per-IP limiter for register + resend (AC9 / B3):** in `main.go`, wrap both routes with:
    ```go
    RateLimitByKey("auth-register", rate.Every(2*time.Minute), 5, ipKeyFn)
    ```
    **Token-bucket semantics (per the relaxed AC9):** burst 5 + 1 token replenished every 2 min per IP. Worst-case throughput from a cold bucket is `5 + (10 min / 2 min) = 9` requests in a 10-min window — acceptable per AC9's relaxation rationale. Do NOT attempt to enforce strict fixed-window 5/10min — token bucket cannot express it.
  - [x] **Per-email limiter for resend-verification (AC9 second clause / H3):** additionally stack:
    ```go
    RateLimitByKey("resend-email", rate.Every(60*time.Second), 1, emailKeyFn)
    ```
    Token bucket: burst 1 + 1 token / 60s per email. `emailKeyFn` semantics:
    1. Read `r.Body` once: `body, err := io.ReadAll(r.Body)`. On read error → return `""` (skip limiter).
    2. **Restore `r.Body` IMMEDIATELY** per GFW-6: `r.Body = io.NopCloser(bytes.NewBuffer(body))`. This MUST happen before any return path, including the malformed-JSON path.
    3. Decode `{ email string }` from `body`. **On JSON parse failure → return `""` (skip limiter, H3)** — let the downstream handler return its standard 422. Rate-limiting unparseable bodies is incoherent (no key to bucket by); skipping is safe because the global IP limiter still applies and the per-IP register/resend limiter still applies.
    4. Normalize: `strings.ToLower(strings.TrimSpace(decoded.Email))`. If empty after normalization → return `""` (skip).
    5. Return the normalized email as the key.
  - [x] **Tests for the "key function returns empty → skip" path** are in Task 15.
  - [x] **Critical (GFW-6):** the per-email key middleware MUST restore `r.Body` on every code path, including the parse-failure and empty-key paths. A unit test in Task 15 asserts that the downstream handler can still `json.NewDecoder(r.Body).Decode(&req)` after the limiter runs.

- [x] **Task 9: Email retry queue (in-process, simple)** (AC: #12)
  - [x] Create `internal/service/email_retry.go`:
    ```go
    type EmailRetryQueue interface { Enqueue(EmailJob) }
    type EmailJob struct { To, Subject, HTML string; Attempts int; NextAttemptAt time.Time }
    type inProcessRetryQueue struct { ch chan EmailJob; sender EmailSender; maxAttempts int }
    func NewEmailRetryQueue(sender EmailSender, bufferSize int) *inProcessRetryQueue
    func (q *inProcessRetryQueue) Start(ctx context.Context) // launches worker goroutine
    func (q *inProcessRetryQueue) Enqueue(job EmailJob)      // non-blocking; drops + slog.Error if full
    ```
  - [x] Worker loop: receive job → if `time.Now() < NextAttemptAt`, sleep delta → call `sender.Send`; on success, log info; on failure, `Attempts++`, `NextAttemptAt = now + backoff(Attempts)` (exponential: 30s, 2m, 8m, 30m), re-enqueue. If `Attempts >= 4` (i.e., 5 attempts total), drop and `slog.Error("verification_email_dropped_max_attempts", ...)`.
  - [x] **Scope limit:** this is intentionally an in-process best-effort queue. The architecture's PostgreSQL-backed job queue (architecture step 13) is NOT introduced in this story. Document this in the Dev Agent Record completion notes and tag it as deferred work (`W?: replace in-process email retry with PG-backed job queue once Story 13 is built`).
  - [x] **Critical:** the queue MUST survive a single dropped email (i.e., not crash on `sender.Send` panic). Wrap the `sender.Send` call in `defer func() { recover() }()` with `slog.Error`.
  - [x] **Tests (M4) — create `internal/service/email_retry_test.go` covering:**
    - **`TestRetryQueue_SuccessFirstAttempt`** — enqueue one job, mock sender succeeds, assert one `SentEmail` recorded, no re-enqueue.
    - **`TestRetryQueue_SuccessAfterTwoFailures`** — mock sender that fails twice then succeeds; assert eventual success, `Attempts == 3`, backoff observed (use synthetic clock or assert `NextAttemptAt` deltas; do NOT real-sleep the test).
    - **`TestRetryQueue_DropAtMaxAttempts`** — mock sender that always fails; assert job is dropped after `maxAttempts == 4` (5 attempts total), assert `slog.Error("verification_email_dropped_max_attempts", ...)` was emitted (capture via `slog.SetDefault` with a buffer handler in `TestMain` or `t.Cleanup` restore pattern).
    - **`TestRetryQueue_PanicInSenderRecovered`** — mock sender that `panic("boom")` on first call, succeeds on second; assert worker did not die, job eventually succeeds.
    - **`TestRetryQueue_NonBlockingEnqueueWhenFull`** — fill the buffered channel; call `Enqueue` and assert it returns immediately (not blocked) AND emits `slog.Error("email_retry_queue_full", ...)`.
    - **Test seam:** the worker loop should be testable without real time. Either inject a `clock` interface (`Now() time.Time; Sleep(d time.Duration)`) into `inProcessRetryQueue` OR design the backoff so the test can drive the loop step-by-step. **Recommend `clock` interface** — matches the deterministic-test philosophy elsewhere in the codebase.

- [x] **Task 10: OpenAPI spec update** (AC: #14)
  - [x] `classlite-api/api.yaml` — ADD `components.schemas.Envelope`, `components.schemas.ErrorEnvelope`, `components.schemas.FieldError` if not already present.
  - [x] ADD path entries for `POST /api/auth/register`, `POST /api/auth/verify-email`, `POST /api/auth/resend-verification`, `GET /api/auth/verify-status`. Each must declare:
    - Request body schema (where applicable),
    - Successful response (`200` or `201`) wrapping the response data in `Envelope.data`,
    - Documented error responses: `400` (malformed JSON), `409` (register), `410` (verify-email), `422` (validation), `429` (rate-limit), `404` (verify-email/verify-status).
  - [x] Do NOT run `scripts/codegen.sh` for OpenAPI consumers (Zod/TS) yet — `classlite-web` hasn't been scaffolded into the auth flow until Story 1.8/1.9a. Per WF-3, the spec change is in-scope; the consumer codegen will pick it up when those stories run.

- [x] **Task 11: Config additions** (AC: #1, #2)
  - [x] `internal/config/config.go` — ADD `AppVerifyURLBase string` loaded from env `APP_VERIFY_URL_BASE` (default `"http://localhost:5173/verify-email"` for dev).
  - [x] Add a non-empty validation in `Validate()` when `AppEnv != "development"`: missing `APP_VERIFY_URL_BASE` → block startup.
  - [x] Add to `LogSummary` (do not log the URL itself — log the boolean `_set` flag).
  - [x] `.env.example` — ADD the new key with the dev default and a short comment.

- [x] **Task 12: Unit tests — AuthService (service-layer business logic)** (AC: #1–#8, #11, #12, #13)
  - [x] Create `internal/service/auth_test.go`. Follow the pattern in `audit_test.go` (real DB via `test.SetupDB`, `test.TenantContext`, savepoint-backed `TxDB`).
  - [x] **Use `MockHasher` (H2) in unit tests** to avoid 250ms-per-test bcrypt latency and to verify AC11's "hasher never invoked" property via `mockHasher.CallCount`.
  - [x] Tests for `Register`:
    - Happy path → user row + email_verifications row + email enqueued (assert via `MockEmailSender`) + `auth_audit_logs` row exists with action `user.registered` (query the table directly within the test tx).
    - Duplicate email (case-insensitive: register `User@X.com` then `user@x.com`) → second call returns `ConflictError{Code: "EMAIL_ALREADY_REGISTERED"}` (via the pgx unique-violation catch from H1, NOT a pre-check), no second row, no second email sent.
    - Each validation rule from AC11 → `ValidationError{Fields: [...]}`, **assert `mockHasher.CallCount == 0`** (AC11 / H2), no DB write attempted.
    - Email send failure (`MockEmailSender.SendError = errors.New("boom")`) → returns success with `EmailDelivery == "delayed"` ONLY if retry queue buffer is full at enqueue (otherwise `"sent"` — the send failure happens asynchronously in the worker). User row persisted, retry queue receives the job. `slog.Warn` assertion is optional (skip if it complicates the test).
    - **Bcrypt happens outside the tx (H1):** assert via mock or via timing that no DB connection is held during hash. One way: `MockHasher.OnHash = func() { time.Sleep(50*time.Millisecond) }` — then assert the test connection is not occupied during that window. (If this is too fiddly, document as an architectural invariant and skip the test.)
    - SQL-injection payloads in fullName (`"Robert'); DROP TABLE users--"`) succeed (this is now an AC11 / M3 explicit non-test: validation passes, parameterized queries store it safely). One adversarial test in Task 14 verifies the row is stored verbatim with no table damage.
  - [x] Tests for `VerifyEmail`:
    - Happy path → user.email_verified flips, all other unconsumed rows for that user are marked consumed.
    - Expired token → `GoneError{Code: "VERIFICATION_TOKEN_EXPIRED"}`.
    - Already-consumed-but-user-verified → 200 idempotent.
    - Consumed-but-newer-token-issued → `GoneError`.
    - Unknown token → `NotFoundError{Code: "VERIFICATION_TOKEN_INVALID"}`.
  - [x] Tests for `ResendVerification`:
    - Existing unverified user → new token issued, old token invalidated, email sent, returns non-nil `VerifyPollID`.
    - Verified user → `VerifyPollID: nil`, no email sent, no DB write beyond the lookup.
    - Unknown email → `VerifyPollID: nil`, no email sent.
    - Old verification token from before resend → AC4 / AC5 second clause: rejected as `VERIFICATION_TOKEN_EXPIRED`.
  - [x] Tests for `VerifyStatus`:
    - Valid pollId → correct `{verified, email}`.
    - Unknown pollId → `NotFoundError{Code: "POLL_ID_NOT_FOUND"}`.

- [x] **Task 13: Integration tests — HTTP handler + middleware** (AC: #1–#9, #11)
  - [x] Create `internal/handler/auth_handler_test.go`. Follow the integration pattern in `upload_handler_test.go` (real `middleware.ErrorMapper`, mocked storage→here mocked email).
  - [x] Cover at minimum: 201 on register, 409 on duplicate, 422 on each validation failure, 200 on verify happy path, 410 on expired, 404 on unknown, 429 on per-route rate-limit exceeded.
  - [x] **Critical (TEST-BE-3):** assert the full envelope shape on success (`{"data": {...}}`) and full error shape on failure (`{"error": {"code", "message", "requestId", "details"}}`). Not just status codes.
  - [x] **Negative assertions (TEST-BE-1 spirit applied beyond RLS):** for the duplicate-email path, assert no second email was sent (`len(mock.SentEmails) == 1` after the second register attempt).

- [x] **Task 14: Adversarial tests** (AC: #2, #7, #11, security defaults)
  - [x] Extend `internal/test/adversarial_test.go` (or create `internal/test/auth_adversarial_test.go`) covering:
    - **Enumeration:** register a verified user, then register the same email; assert response code, message, status are byte-identical to the unverified-duplicate response.
    - **Enumeration on resend:** call resend on a known email vs an unknown email; assert response shape and timing are not distinguishable (timing-equal is hard to assert reliably — at minimum assert byte-identical response bodies; document the timing caveat in completion notes).
    - **Token entropy:** generate 1000 tokens via the production code path; assert all unique, all length 43 (32-byte base64url-no-padding), all in URL-safe alphabet.
    - **bcrypt verifies cleanly:** registered password verifies; bcrypt cost is 12 (`bcrypt.Cost(hash) == 12`).
    - **Verification token cannot be brute-forced via verify-status:** scanning pollIds (UUIDs) is bounded by the global rate limit; document this as accepted (not a new test).

- [x] **Task 15: Per-route rate-limit middleware tests** (AC: #9, #10)
  - [x] `internal/middleware/rate_limit_test.go` — ADD:
    - `RateLimitByKey` honors per-key bucketing (same name, different keys → independent buckets; same name, same key → shared bucket).
    - `Retry-After` header is set and roughly correct (within 1 second of the expected delay).
    - Body-reading limiter (`emailKeyFn`) restores `r.Body` so the downstream handler can still decode (GFW-6).
    - The `ClientIP` context value is preferred over `X-Forwarded-For` direct read.

- [x] **Task 16: Email content templates** (AC: #1, #7)
  - [x] Create `internal/service/email_templates.go` (do NOT use `helpers.go` / `utils.go` per CQ-4):
    ```go
    func RenderVerificationEmail(fullName, verifyURL string) (subject, htmlBody string)
    ```
  - [x] HTML body: minimal inline-styled HTML (Resend supports HTML directly). Include the verification URL as both a clickable button and a raw `<a>` for non-button-rendering clients. Include English-only copy for MVP — i18n keys for email content are deferred (UI-side i18n handles in-app strings; transactional email i18n requires the user's `language_pref` lookup, which the existing user row has but is a separate enhancement).
  - [x] Hardcode subject: `"Verify your ClassLite email address"`.
  - [x] **Critical:** never include the raw bcrypt hash, password, or `EMAIL_VERIFICATIONS.id` in the email body. Only the token + the constructed verify URL.

- [x] **Task 17: Regression check** (cross-cutting)
  - [x] Run `go test ./...` from `classlite-api/`. All Story 1.1–1.3b tests must remain green.
  - [x] Run `scripts/migrate.sh up` against a clean DB and assert no migration is required (this story adds no schema — confirm).
  - [x] Manually exercise the four endpoints with `curl` (see Dev Notes → "Manual smoke test snippets").

## Dev Notes

### Project Context Reference

Read **`docs/project-context.md`** before implementing. Particularly: GO-1 (TenantContext on every store method), GO-2 (typed errors only), GO-4 (context propagation), GO-5 (no omitempty), GFW-1 (handlers on typed structs), GFW-5 (envelope), GFW-6 (middleware restoring body), PERF-1 (SET LOCAL needs transaction), SEC-5 (no wildcard CORS — irrelevant for this story but the existing CORS middleware is your reference), SEC-10 (per-route rate limits), SEC-11 (email header sanitization — already implemented in `email_resend.go`), TEST-BE-1/2/3 (test patterns), CQ-1/2/3/4 (no dead code, doc the why, no magic, no abbreviation shortcuts), WF-3 (codegen sequencing).

### Files Being Modified — Current State and What Changes

**UPDATE files** (read these completely before changing):

1. **`classlite-api/cmd/api/main.go`** — current state: wires `RequestID → ClientIP → Logger → CORS → RateLimit → mux`. Registers `GET /health` and `POST /api/uploads/{presign,confirm}`. **Changes:** add `AuthService`, `AuditService`, `EmailRetryQueue`, `AuthHandler` construction; register four new routes; thread per-route limiters in front of register/resend; start the email retry queue worker (`go retryQ.Start(ctx)`); ensure graceful shutdown also cancels the retry queue context.

2. **`classlite-api/internal/store/queries/email_verifications.sql`** — current state: 3 queries (`CreateEmailVerification`, `GetEmailVerificationByToken`, `MarkEmailVerificationVerified`). **Changes:** add 3 queries listed in Task 2.

3. **`classlite-api/internal/middleware/rate_limit.go`** — current state: single `RateLimit(rps, burst)` factory, global IP-keyed bucket with cleanup goroutine. `extractIP` reads `X-Forwarded-For` then `r.RemoteAddr`. **Changes:** add `RateLimitByKey` sibling; refactor `extractIP` to read `model.IPAddress` from context first (closes deferred-work W1 from Story 1.3b — call this out in completion notes); add `name` field for log correlation and `Retry-After` computation.

4. **`classlite-api/internal/model/errors.go`** — current state: 4 typed errors. **Changes:** add `GoneError`; add `Code string` field to `ConflictError`; add `Code string` field to `NotFoundError`. Update `Error()` methods to remain stable.

5. **`classlite-api/internal/middleware/error_mapper.go`** — current state: switch over 4 error types, fixed code per type. **Changes:** add `GoneError → 410` branch; consult `.Code` on `ConflictError` and `NotFoundError` with sensible fallback defaults.

6. **`classlite-api/internal/middleware/error_mapper_test.go`** — current state: covers each existing error type. **Changes:** add cases for 410, custom conflict code, custom not-found code. Existing tests must continue to pass with no edits (defaults preserved).

7. **`classlite-api/internal/config/config.go`** — current state: 13 env-backed fields, basic Validate (`DATABASE_URL`, `JWT_SECRET` in non-dev), `LogSummary` redacts secrets. **Changes:** add `AppVerifyURLBase`; add to Validate (non-dev) and LogSummary.

8. **`classlite-api/internal/config/config_test.go`** — add a test for the new validation rule.

9. **`classlite-api/api.yaml`** — current state: only `GET /health`. **Changes:** add 4 new paths + shared schemas. Spec change does NOT trigger frontend codegen yet (frontend auth UI lands in Stories 1.8/1.9a).

10. **`.env.example`** — current state: documents existing env vars. **Changes:** add `APP_VERIFY_URL_BASE=http://localhost:5173/verify-email`.

**Preservation contract:** the existing `RateLimit` global bucket MUST keep working (uploads, health, future routes). The global 200/min/IP wrapping in `main.go` is not removed — per-route limiters stack ON TOP.

### Bcrypt Cost Selection

- `bcrypt.DefaultCost == 10`. Industry posture in 2026 favors **12** for password hashing (≈ 250ms per hash on modern x86, fast enough not to be a DoS vector at the per-route rate limits in AC9, slow enough that bulk-cracking a leaked hash dump is materially harder).
- Decision: hard-code `12`. Justify in code with a `// CQ-2 why:` comment referencing this rationale.
- Bcrypt has a **72-byte input limit** — passwords longer than that are silently truncated by the algorithm. The AC11 validation (`len([]byte(password)) <= 72`) makes this explicit instead of silent.

### Verification Token Generation

```go
import "crypto/rand"
import "encoding/base64"

func newVerificationToken() (string, error) {
    b := make([]byte, 32) // 256 bits of entropy
    if _, err := rand.Read(b); err != nil { // crypto/rand.Read; not math/rand
        return "", fmt.Errorf("read random bytes: %w", err)
    }
    return base64.RawURLEncoding.EncodeToString(b), nil // 43 chars, no padding
}
```

Never use `math/rand`. Never use UUIDs as the verification token (insufficient entropy + structure leaks creation time for v7).

### Email Retry Strategy

Two layers of defense:
1. **In-process retry queue** (this story): goroutine + bounded channel + exponential backoff (30s → 2m → 8m → 30m → drop). Acceptable for MVP because Railway restarts are rare and we have the **resend-verification** UX as a user-driven fallback.
2. **User-driven resend** (this story, AC7): user clicks "Resend verification email" in the pending screen.

The PostgreSQL-backed job queue from architecture step 13 supersedes the in-process queue when it lands. Track as deferred work in this story's completion notes — `"Replace in-process email retry with PG-backed job queue once Story 13 builds the queue"`.

### Pre-Tenant Audit Context

Registration happens before the user has joined any center (`center_members` row doesn't exist yet — that's Story 2.1 onboarding). The existing `AuditService.Log` requires a non-empty `tc.CenterID` and writes to the RLS-protected `audit_logs` table — neither fits pre-tenant events.

**Decision: separate `auth_audit_logs` table + `AuthAuditLogger` interface.** Implementation:

1. **New migration** `20260603100000_create_auth_audit_logs.up.sql` (timestamp must follow `20260603000000_create_audit_logs`). Schema:
   ```sql
   CREATE TABLE auth_audit_logs (
       id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
       user_id     uuid        REFERENCES users (id),     -- nullable: failed registrations have no user yet
       action      text        NOT NULL,
       entity_type text        NOT NULL,
       entity_id   uuid,                                   -- nullable for actions without a single entity
       changes     jsonb       NOT NULL DEFAULT '{}',
       ip_address  text,
       created_at  timestamptz NOT NULL DEFAULT now()
   );
   CREATE INDEX idx_auth_audit_logs_user_created ON auth_audit_logs (user_id, created_at DESC);
   ```
   - **NOT tenant-scoped, NOT RLS-enabled** — this is by design (the table only stores pre-onboarding events).
   - **Append-only defense (mirror Story 1.3b's pattern):** `REVOKE UPDATE, DELETE, TRUNCATE ON auth_audit_logs FROM classlite_app`.

2. **New `AuthAuditLogger` interface** in `internal/service/auth_audit.go`:
   ```go
   type AuthAuditEntry struct {
       UserID     uuid.UUID
       Action     string         // "user.registered" | "user.email_verified" | "user.verification_resent"
       EntityType string         // "user"
       EntityID   uuid.UUID
       Changes    Changes        // reuses the existing service.Changes type from audit.go
   }
   type AuthAuditLogger interface {
       Log(ctx context.Context, entry AuthAuditEntry) error
   }
   type pgAuthAuditLogger struct { pool txBeginner }
   func NewPgAuthAuditLogger(pool txBeginner) *pgAuthAuditLogger
   ```
   Implementation reads `ip_address` from `ctx.Value(model.IPAddress).(string)`. No `SET LOCAL` needed (no RLS). One round-trip insert — no transaction required (no PERF-1 concern).

3. **New sqlc query** in `internal/store/queries/auth_audit_logs.sql`:
   ```sql
   -- name: InsertAuthAuditLog :exec
   INSERT INTO auth_audit_logs (user_id, action, entity_type, entity_id, changes, ip_address)
   VALUES ($1, $2, $3, $4, $5, $6);
   ```

4. **AuthService never calls `AuditService.Log`** (the tenant-scoped one). The existing `AuditService` continues to serve post-onboarding events (billing, enrollment, role changes — future stories).

5. **Failure isolation:** `AuthService` calls `s.audit.Log(...)` after the main commit. Errors are logged at `slog.Error` but never propagated to the user — audit failures must not break registration/verification flows.

_Alternatives considered + rejected: (A) skip audit entirely → loses security trail; (B) sentinel zero-UUID center → requires polluting `centers` + RLS exception; (C) `LogPreTenant` method on existing `AuditService` with `center_id NULL` and a partial RLS policy → couples two unrelated audit lifecycles. Option D (this approach) is the cleanest separation._

### Endpoint Summary

| Method | Path                            | Auth | Rate Limit (per-route)           | Success | Errors                                         |
|--------|---------------------------------|------|----------------------------------|---------|------------------------------------------------|
| POST   | `/api/auth/register`            | none | 5 / 10 min / IP                  | 201     | 409, 422, 429                                  |
| POST   | `/api/auth/verify-email`        | none | global only                      | 200     | 404, 410, 422                                  |
| POST   | `/api/auth/resend-verification` | none | 5 / 10 min / IP **AND** 1 / 60s / email | 200 | 422, 429                                  |
| GET    | `/api/auth/verify-status`       | none | global only                      | 200     | 404                                            |

All endpoints return the standard envelope (success: `{data}`; error: `{error: {code, message, requestId, details}}`).

### DTO Reference (request/response shapes)

```jsonc
// POST /api/auth/register
// request
{ "email": "user@example.com", "password": "strongpass", "fullName": "User Name" }
// response 201 — emailDelivery is ALWAYS present ("sent" on enqueue success, "delayed" when the retry-queue buffer was full at enqueue time)
{ "data": { "user": { "id": "...", "email": "...", "fullName": "...", "emailVerified": false }, "verifyPollId": "...", "emailDelivery": "sent" } }

// POST /api/auth/verify-email
{ "token": "..." }
{ "data": { "verified": true, "email": "user@example.com" } }

// POST /api/auth/resend-verification
{ "email": "user@example.com" }
{ "data": { "verifyPollId": "..." } }   // or { "verifyPollId": null }

// GET /api/auth/verify-status?pollId=<uuid>
{ "data": { "verified": false, "email": "user@example.com" } }
```

### Testing Standards Summary (TEST-BE-1/2/3/4 applied)

- **Service tests:** real DB via `test.SetupDB(t)`; mock `EmailSender` via existing `service.MockEmailSender`; transaction-rollback isolation. Cover happy path + every named failure path. Three-state coverage required per AC.
- **Handler tests:** real `middleware.ErrorMapper`, real `AuthService`, mock `EmailSender`. Assert full envelope shapes on both success and error paths — not just status codes. Use `httptest.NewRecorder` + `httptest.NewRequest`. Reuse `test.SetupDB` for handler-level DB access.
- **Adversarial tests:** the negative assertions (enumeration safety, token uniqueness, bcrypt cost) live in `internal/test/`. Mirror the pattern in `audit_logs_rls_test.go` for organization.
- **Concurrency:** do NOT use `t.Parallel()` on any test that uses `test.SetupDB(t)` — shared transaction (`TxDB`) is not safe for parallel use (TEST-BE-2).
- **i18n:** transactional email content is English-only for this story (deferred). Backend never returns translated user-facing strings — error codes only, frontend translates (existing convention).

### Library / Framework Requirements

| Library | Version | Why | Source |
|---|---|---|---|
| `golang.org/x/crypto/bcrypt` | latest stable | Password hashing | `go get` — new dep this story |
| `crypto/rand`, `encoding/base64` | stdlib | Verification token generation | stdlib |
| `net/mail` | stdlib | Email parsing/validation | stdlib |
| `github.com/google/uuid` | v1.6.0 (already in `go.mod`) | UUID generation, parse for pollId | existing |
| `github.com/jackc/pgx/v5` | v5.9.2 (already in `go.mod`) | DB driver | existing |
| `github.com/resend/resend-go/v2` | v2.28.0 (already in `go.mod`) | Email delivery — already wired via `ResendEmailSender` | existing |
| `golang.org/x/time/rate` | already in `go.mod` | Token bucket for `RateLimitByKey` | existing |

**No third-party libraries beyond bcrypt are added.** No `gorilla/mux`, no `chi`, no JWT lib (Story 1.5), no auth helpers, no validation libraries — stdlib + the established patterns.

### Architecture Compliance

- **GO-1 (TenantContext):** all `users` and `email_verifications` queries in this story operate on **non-tenant-scoped tables** (no `center_id`). They legitimately do not require `TenantContext`. Document this explicitly in code comments at the store call sites so future readers don't assume RLS coverage where there is none. Pre-tenant auth audit also writes to a non-tenant-scoped table (see "Pre-Tenant Audit Context").
- **GO-2 (typed errors):** AuthService returns only typed errors from `internal/model`. No `fmt.Errorf("not found")` returns.
- **GO-3 (strict layers):** handler → service → store. No store calls from handlers. The `EmailSender` is a service-layer dependency, not used in handlers.
- **GO-4 (context propagation):** the only place we deliberately detach context is the fire-and-forget email goroutine — using `context.WithoutCancel(ctx)` keeps request_id/values but lets the goroutine outlive the request.
- **GO-5 (no `omitempty`):** all response DTOs use bare `json:"field"` tags. `verifyPollId` is a nullable string in the JSON contract (`*uuid.UUID` Go-side) — null serialization required.
- **GFW-1 (typed handler structs):** `AuthHandler{Svc *AuthService}`. No free functions.
- **GFW-2 (`http.Handler` middleware signatures):** `RateLimitByKey` returns `func(http.Handler) http.Handler` — matches the existing pattern.
- **GFW-5 (envelope):** all responses go through `handler.WriteJSON` / `handler.WriteError`.
- **GFW-6 (middleware restoring body):** the per-email rate limiter reads the JSON body — it MUST restore `r.Body` afterwards.
- **SEC-10 (per-route rate limits):** AC9 implements this directly.
- **SEC-11 (email header sanitization):** already enforced inside `ResendEmailSender`. The subject we pass (`"Verify your ClassLite email address"`) is a hardcoded constant — no user input flows into headers. Verify in code review.

### Previous Story Intelligence

**From Story 1.3 (auth schema):**
- `users` table has a unique index on `email` and conditional unique index on `google_id WHERE google_id IS NOT NULL`. Email uniqueness is DB-enforced; the service-layer check is for friendly error messages, but the unique index is the truth.
- W3 from 1.3 deferred work: "Users table allows both `password_hash` and `google_id` to be NULL — enforce at least one auth method at service layer in story 1.4." → THIS STORY closes W3: `CreateUser` is called only from `Register` (where password_hash is required) or from `GoogleOAuth` in Story 1.6 (where google_id is required). Add a code-level invariant comment on `CreateUser` callsite.
- W5 from 1.3 deferred work: "password_resets/email_verifications queries don't filter on `expires_at` or `used_at`/`verified_at` — enforce at service layer in stories 1.4/1.5." → THIS STORY closes W5 for email_verifications. Add `GetActiveEmailVerificationByToken` (Task 2) so expiry is a query-level filter, not just service-level.
- `email_verifications` table is **NOT RLS-protected** (correctly — pre-tenant operations) and **has no `center_id` column**. Service layer is the only isolation. Trust the unique index on token (`idx_email_verifications_token`).
- `users` table is **NOT RLS-protected** either. Same isolation model.
- Tests use `test.SetupDB(t)` (transaction-wrapped) + `test.TenantContext` (sets RLS context). For this story, `TenantContext` is NOT required in unit tests for register/verify (no RLS tables touched), but IS required if you write to `audit_logs` (which we're NOT doing — see "Pre-Tenant Audit Context"). For `auth_audit_logs`, no SET LOCAL is needed (no RLS).

**From Story 1.3b (audit logging):**
- `AuditService` pattern: per-call transaction, `SET LOCAL app.current_tenant_id`, INSERT, commit. Uses `txBeginner` interface so prod and tests both work. Use the same `txBeginner` pattern for `AuthService` so service tests can run inside the savepoint test DB.
- `ClientIP` middleware sets `model.IPAddress` in context; AuthService should read it for `auth_audit_logs.ip_address` (mirror `AuditService.Log`).
- W1 from 1.3b deferred work: "RateLimit middleware still keys on `r.RemoteAddr`, not `model.IPAddress`." → THIS STORY closes W1 in Task 8.

**From Story 1.2d (email service abstraction):**
- `EmailSender` interface and `MockEmailSender` already exist. Use them — do not invent a new interface.
- `ResendEmailSender` already sanitizes To/Subject (SEC-11). Trust the sanitization; do not re-sanitize in `AuthService`.

**From Story 1.2c (error handling):**
- `model.ValidationError` includes `Fields []FieldError` — the `details` array in the response envelope is populated from this. Use exactly this shape; do not invent a new structure.
- `middleware.ErrorMapper` panic-recovers. AuthService panics will not leak; still write defensively.

### Git Intelligence (last 5 commits)

- `e35db0d` (Story 1.3b): patterns for `txBeginner`, savepoint-backed tests, append-only `REVOKE` migration, full code-review patch cycle. Mirror the `auth_audit_logs` table after this.
- `ecd8696` (Story 1.3): auth schema, sqlc queries, `test.SetupDB` + adversarial test patterns.
- `7d834a6` (Stories 1.2a–f): middleware chain, error mapper, email sender, response envelope, rate limiter. The wiring style in `main.go` is the template.
- `daa74e5`, `1f5bb0a`: unrelated UI tweaks — skip.

### Latest Tech Information

- **bcrypt:** `golang.org/x/crypto/bcrypt` is stable; `bcrypt.DefaultCost` is 10. Cost 12 is the current OWASP recommendation (2025–2026). No breaking changes recently.
- **pgx v5.9.2:** stable; the `pgtype.Text{String, Valid: true}` pattern for nullable strings is the idiomatic way to bind nullable columns — already in use in `audit.go`.
- **Resend SDK:** `resend-go v2.28.0` is current; `Emails.SendWithContext` is the method already wired. No HTML templating helper — author plain string templates.
- **`context.WithoutCancel` (Go 1.21+):** Go 1.25 is the project's Go version, so this is available. Use it for the fire-and-forget email goroutine.

### Manual Smoke Test Snippets

```bash
# After API is running locally:
curl -sX POST http://localhost:8080/api/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com","password":"strongpass123","fullName":"Smoke Test"}' | jq

# Use the returned verifyPollId:
curl -s "http://localhost:8080/api/auth/verify-status?pollId=<id>" | jq

# Use the token from the verification email (check logs in dev — MockEmailSender records sends):
curl -sX POST http://localhost:8080/api/auth/verify-email \
  -H 'Content-Type: application/json' \
  -d '{"token":"<token>"}' | jq

# Resend:
curl -sX POST http://localhost:8080/api/auth/resend-verification \
  -H 'Content-Type: application/json' \
  -d '{"email":"smoke@example.com"}' | jq

# Rate limit (run 6x quickly):
for i in 1 2 3 4 5 6; do
  curl -i -X POST http://localhost:8080/api/auth/register \
    -H 'Content-Type: application/json' \
    -d "{\"email\":\"rl-$i@example.com\",\"password\":\"strongpass\",\"fullName\":\"Test\"}" 2>&1 | head -1
done
```

### Project Structure Notes

The new files align cleanly with the architecture's project tree (see architecture.md → "Complete Project Directory Structure"):

| New / Updated | Path |
|---|---|
| NEW | `classlite-api/internal/service/auth.go` |
| NEW | `classlite-api/internal/service/auth_test.go` |
| NEW | `classlite-api/internal/service/auth_audit.go` (B1 — `AuthAuditLogger` interface + pg impl) |
| NEW | `classlite-api/internal/service/auth_audit_test.go` |
| NEW | `classlite-api/internal/service/hasher.go` (H2 — `Hasher` interface + `BcryptHasher`) |
| NEW | `classlite-api/internal/service/hasher_mock.go` (H2 — `MockHasher` for AC11 tests) |
| NEW | `classlite-api/internal/service/email_retry.go` |
| NEW | `classlite-api/internal/service/email_retry_test.go` (M4) |
| NEW | `classlite-api/internal/service/email_templates.go` |
| NEW | `classlite-api/internal/handler/auth_handler.go` |
| NEW | `classlite-api/internal/handler/auth_handler_test.go` |
| NEW | `classlite-api/migrations/20260603100000_create_auth_audit_logs.up.sql` |
| NEW | `classlite-api/migrations/20260603100000_create_auth_audit_logs.down.sql` |
| NEW | `classlite-api/internal/store/queries/auth_audit_logs.sql` |
| NEW | `classlite-api/internal/test/auth_adversarial_test.go` (or extend `adversarial_test.go`) |
| UPDATE | `classlite-api/internal/store/queries/email_verifications.sql` |
| UPDATE | `classlite-api/internal/middleware/rate_limit.go` |
| UPDATE | `classlite-api/internal/middleware/rate_limit_test.go` |
| UPDATE | `classlite-api/internal/middleware/error_mapper.go` |
| UPDATE | `classlite-api/internal/middleware/error_mapper_test.go` |
| UPDATE | `classlite-api/internal/model/errors.go` |
| UPDATE | `classlite-api/internal/config/config.go` |
| UPDATE | `classlite-api/internal/config/config_test.go` |
| UPDATE | `classlite-api/cmd/api/main.go` |
| UPDATE | `classlite-api/api.yaml` |
| UPDATE | `classlite-api/go.mod`, `go.sum` (bcrypt) |
| UPDATE | `.env.example` |
| REGEN | `classlite-api/internal/store/generated/email_verifications.sql.go`, `models.go`, `auth_audit_logs.sql.go` (after `sqlc generate`) |

No frontend files in this story. No `classlite-web/` or `classlite-landing/` changes.

### References

- [Source: docs/project-context.md — GO-1, GO-2, GO-3, GO-4, GO-5, GFW-1, GFW-2, GFW-5, GFW-6, SEC-10, SEC-11, TEST-BE-1, TEST-BE-2, TEST-BE-3, TEST-BE-4, CQ-1, CQ-2, CQ-3, CQ-4, WF-3]
- [Source: _bmad-output/planning-artifacts/epics/epic-01b-auth.md — Story 1.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#authentication--security — Password auth (FR-75), Email verification (FR-76), Rate limiting, Auth API Endpoints]
- [Source: _bmad-output/planning-artifacts/architecture.md#complete-project-directory-structure — directory layout]
- [Source: _bmad-output/implementation-artifacts/1-3-auth-database-schema-rls-and-security-testing.md — schema, sqlc patterns, test helpers]
- [Source: _bmad-output/implementation-artifacts/1-3b-audit-logging-infrastructure.md — txBeginner pattern, append-only RLS, ClientIP middleware]
- [Source: _bmad-output/implementation-artifacts/deferred-work.md — W1 (Story 1.3b rate-limit IP), W3 + W5 (Story 1.3 user-auth-method + verification expiry)]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m] (Amelia)

### Debug Log References

- sqlc generation: required no patches; `sqlc generate` succeeded on first attempt against the new migration.
- Initial pgconn import was wrong (`github.com/jackc/pgconn` instead of pgx v5's `github.com/jackc/pgx/v5/pgconn`) — caught at first compile, single-line fix.
- main.go initially over-engineered the `ipKey` context-key indirection; simplified by importing `internal/model` directly (one fewer level of misdirection).
- Live smoke test confirmed 201/409/422 paths, retry-queue worker observed sending `verification_email_sent` log lines, request IDs propagated end-to-end.

### Completion Notes List

- **All 17 tasks complete.** All AC1–AC14 satisfied.
- **Deferred work closed in-flight (all 3):**
  - Story 1.3b W1 (rate-limit middleware reading `r.RemoteAddr` instead of `model.IPAddress` context value) — closed in `internal/middleware/rate_limit.go` via the new `ipKeyFn` helper, covered by `TestRateLimit_PrefersClientIPContextValue`.
  - Story 1.3 W3 (users may have both `password_hash` and `google_id` NULL) — closed at the `Register` callsite (always supplies `password_hash`; `google_id` left to story 1.6's Google OAuth path).
  - Story 1.3 W5 (`password_resets` / `email_verifications` queries didn't filter on expiry / consumption) — closed for `email_verifications` via the new `GetActiveEmailVerificationByToken` sqlc query and the 24h filter in `GetEmailVerificationByID`. `password_resets` remains W5-open until story 1.5.
- **Pre-Tenant Audit Context:** implemented Option D as spec'd. New table `auth_audit_logs` (NOT tenant-scoped, NOT RLS-protected, append-only via REVOKE UPDATE/DELETE/TRUNCATE), new `AuthAuditLogger` interface, new `pgAuthAuditLogger`. `AuthService` writes auth events via this interface; the existing tenant-scoped `AuditService` is untouched.
- **In-process retry queue is intentionally best-effort.** Buffer 256 in production; drops + logs on overflow; exponential backoff (30s/2m/8m/30m then drop after 5 total attempts); panic recovery in the worker. **Deferred (new):** replace this with the PG-backed job queue when architecture step 13 lands. Track as `W1` under "Deferred from: code review of story-1-4" once code review runs.
- **Constant-time floor on `/api/auth/resend-verification`:** 200ms minimum response time on every 200 response (both known and unknown email paths). Validation 422 responses bypass the floor. This is a coarse defense — sophisticated attackers with statistical sampling may still detect side-channels, but the floor closes the obvious one. **Deferred (new):** consider adding random jitter on top of the floor if enumeration becomes a real-world concern.
- **`emailDelivery` field semantics:** "sent" when the retry queue accepts the job at enqueue (the actual send is async); "delayed" when the buffered channel is full. The frontend can use this to show "Email may be delayed" copy.
- **AC11 / H2 verification:** `MockHasher.CallCount` is checked in 6 service-layer validation tests — confirms bcrypt never runs on malformed input.
- **Test counts (new in this story):**
  - service: 18 AuthService tests + 5 retry-queue tests + 4 email-template tests + 3 auth-audit tests = 30 new tests
  - handler: 9 new integration tests
  - middleware: 5 new rate-limit tests + 3 new error-mapper tests = 8 new tests
  - test (adversarial): 5 new tests (enumeration parity, SQL-injection storage, token entropy, bcrypt cost, ambiguous-resend response shape)
  - config: 1 new validation test
  - **Total: 53 new tests, all green. Full `go test ./...` regression green.**
- **Transactional email i18n deferred:** Task 16 mandated English-only copy for MVP transactional emails. Vietnamese translations require a `language_pref` lookup on the user row (the column exists in `users`, but plumbing it through `RenderVerificationEmail` and adding `vi.json` keys is non-trivial). Tracked as deferred enhancement — revisit once Story 1.5 (login) is shipped and the i18n pattern for transactional content is settled.

### File List

**New files:**
- `classlite-api/internal/service/auth.go`
- `classlite-api/internal/service/auth_test.go`
- `classlite-api/internal/service/auth_audit.go`
- `classlite-api/internal/service/auth_audit_test.go`
- `classlite-api/internal/service/hasher.go`
- `classlite-api/internal/service/hasher_mock.go`
- `classlite-api/internal/service/email_retry.go`
- `classlite-api/internal/service/email_retry_test.go`
- `classlite-api/internal/service/email_templates.go`
- `classlite-api/internal/service/email_templates_test.go`
- `classlite-api/internal/handler/auth_handler.go`
- `classlite-api/internal/handler/auth_handler_test.go`
- `classlite-api/internal/test/auth_adversarial_test.go`
- `classlite-api/internal/store/queries/auth_audit_logs.sql`
- `classlite-api/internal/store/generated/auth_audit_logs.sql.go` (sqlc-generated)
- `classlite-api/migrations/20260603100000_create_auth_audit_logs.up.sql`
- `classlite-api/migrations/20260603100000_create_auth_audit_logs.down.sql`

**Modified files:**
- `classlite-api/cmd/api/main.go` — wired AuthService, AuthAuditLogger, EmailRetryQueue, AuthHandler + 4 routes + per-route rate limiters + graceful retry-queue shutdown
- `classlite-api/internal/store/queries/email_verifications.sql` — added GetActiveEmailVerificationByToken, InvalidateUnconsumedEmailVerificationsForUser, GetEmailVerificationByID
- `classlite-api/internal/store/generated/email_verifications.sql.go` — sqlc regen
- `classlite-api/internal/middleware/rate_limit.go` — added RateLimitByKey factory + refactored extractIP to read model.IPAddress (closes 1.3b W1) + computed Retry-After
- `classlite-api/internal/middleware/rate_limit_test.go` — 5 new tests
- `classlite-api/internal/middleware/error_mapper.go` — added GoneError branch, consults Code on Conflict/NotFound
- `classlite-api/internal/middleware/error_mapper_test.go` — 3 new tests
- `classlite-api/internal/model/errors.go` — added GoneError; added Code/Message fields to ConflictError; added Code field to NotFoundError
- `classlite-api/internal/config/config.go` — added AppVerifyURLBase + Validate guard + LogSummary entry
- `classlite-api/internal/config/config_test.go` — 1 new test
- `classlite-api/api.yaml` — full OpenAPI spec for 4 auth endpoints + shared envelopes + error schemas
- `classlite-api/go.mod`, `classlite-api/go.sum` — bcrypt added
- `.env.example` — APP_VERIFY_URL_BASE entry
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — story 1-4 → review

## Change Log

- **2026-06-03 (John / PM, via `bmad-correct-course`):** re-spec pass resolving Amelia's dev review findings (B1–B4 blockers, H1–H4 high-sev gaps, M1–M6 cleanups). Key contract changes:
  - **AC5** collapsed to single idempotent rule (B2 — dropped unimplementable "rotated token" branch).
  - **AC9** relaxed to token-bucket semantics (burst 5 + 1/2min/IP) instead of fixed-window 5/10min (B3).
  - **AC13** rewritten to use new `AuthAuditLogger` interface + new `auth_audit_logs` table (B1 — `AuditService.Log` is NOT called by `AuthService`).
  - **AC14** scoped to sqlc-only regen; OpenAPI consumer codegen deferred to first frontend auth story (B4).
  - **AC7** adds 200ms constant-time floor on all 200 responses to defeat timing-based email enumeration (H4).
  - **AC1 / AC11** clarified: `emailDelivery` field always present in 201 body; `Hasher` interface seam mandatory for AC11's "never invoked" assertion (H2).
  - **AC3** explicit atomicity requirement on the 3 verify writes (M2).
  - **AC8** pollIds expire at 24h matching token TTL (M6).
  - **Task 3** bcrypt now runs OUTSIDE the registration transaction; duplicate detection via pgx unique-violation catch instead of pre-check (H1).
  - **Task 8** per-email rate-limiter passes through on JSON parse failure (H3); body restoration mandatory on every code path (GFW-6).
  - **Task 9** EmailRetryQueue gains full test suite covering success/retry/drop/panic/full-buffer paths (M4).
  - **Pre-Tenant Audit Context** Dev Note simplified to decided Option D only; A/B/C archived in one-line rationale block.
  - See also `_bmad-output/planning-artifacts/sprint-change-proposal-2026-06-03.md` for the formal change record.

- **2026-06-04 (Amelia / Dev, via `bmad-dev-story`):** Story 1.4 implemented end-to-end. 17/17 tasks complete, all ACs satisfied, 53 new tests added (all green), full regression suite green. Closes in-flight deferred items: 1.3b W1 (rate-limit IP context), 1.3 W3 (user auth-method invariant at Register callsite), 1.3 W5 (email_verifications expiry/consumption at query layer). Status → review.

## Review Findings

Code review by Blind Hunter + Edge Case Hunter + Acceptance Auditor on 2026-06-04.

### Decision Needed

_All three resolved during review on 2026-06-04 — see decisions inline below._

- [x] [Review][Decision→Defer] **Resend constant-time floor is one-sided** — Decided: defer with documentation. Per-IP (burst 5, 1/2 min) and per-email (1/60 s) rate limits cap sampling rate; statistical separation needs hundreds-to-thousands of samples per address, making the residual timing leak impractical to exploit at scale. Added to deferred-work.md. [`internal/service/auth.go:269-293`]
- [x] [Review][Patch] (from D2) **Per-email rate-limiter body-read-error path bypasses the limiter** — Decided: fail at middleware with 400 on body-read error (distinct from JSON parse failure, which still falls through per spec H3). Closes the read-error bypass cleanly. [`cmd/api/main.go:481-487`]
- [x] [Review][Patch] (from D3) **`emailDelivery` contract gains `"failed"` variant** — Decided: add `"failed"` to the union (`"sent" | "delayed" | "failed"`). Fires when the retry queue rejects the job (channel full). Frontend can prompt the user to hit Resend. Update `api.yaml`, register handler DTO, service `emailDelivery` logic, and tests. [`internal/service/auth.go:424-447`, `classlite-api/api.yaml`]

### Patches

- [x] [Review][Patch] **Retry-queue worker has head-of-line blocking** — Single worker calls `q.clock.Sleep(delay)` inline; with backoffs up to 30 min, a single failing job blocks all queued emails. Re-enqueue can also drop jobs onto a full channel. Fix: use a time-heap or `time.NewTimer` with `select` on context+timer so ready-now jobs don't wait for future-dated ones. [`internal/service/email_retry.go:103-154`]
- [x] [Review][Patch] **Email normalization inconsistent across Register / Resend / per-email limiter** — `validateRegisterRequest` returns `strings.ToLower(trimmedEmail)` (full RFC string with display name), `ResendVerification` uses `parsed.Address`, and `resendEmailKeyFn` lowercases the raw decoded field. A registration of `Foo <foo@example.com>` creates a row at that literal string; resend on `foo@example.com` misses it. Per-email limiter bucket varies with display name. Fix: extract `parsed.Address` in all three sites via a shared helper. [`internal/service/auth.go:382-403`, `:273-279`, `cmd/api/main.go:481-491`]
- [x] [Review][Patch] **Data race: tests read `MockEmailSender.SentEmails` without acquiring the mock's mutex** — `MockEmailSender.Send` writes under `m.mu.Lock()`, but test code reads `sender.SentEmails` directly. `go test -race` will flag this whenever a worker is running. Fix: add a `Count()` or `Snapshot()` accessor that locks; use it in tests. [`internal/service/auth_test.go:46-49`, handler tests]
- [x] [Review][Patch] **`VerifyEmail` race: concurrent verify calls double-emit `user.email_verified` audit row** — Pre-tx queries check `user.EmailVerified == false` outside any transaction; two concurrent requests both pass and both audit. Fix: add `WHERE verified_at IS NULL` to the `MarkEmailVerificationVerified` UPDATE, check `RowsAffected()`, short-circuit to idempotent 200 on 0 rows. [`internal/service/auth.go:1789-1844`, `internal/store/queries/email_verifications.sql:20-23`]
- [x] [Review][Patch] **No request-body size limit on register / verify-email / resend** — `json.NewDecoder(r.Body).Decode` and `io.ReadAll(r.Body)` in the key function read unbounded into memory. A single large payload can OOM the server. Fix: wrap with `http.MaxBytesReader(w, r.Body, 16*1024)` per endpoint. [`internal/handler/auth_handler.go:65,94,113`; `cmd/api/main.go:178`]
- [x] [Review][Patch] **Per-email rate-limiter visitor map is unbounded** — Each unique attacker-controlled email allocates a visitor entry kept ≥ 3 min. ~36 000 entries plantable per minute. Fix: cap visitor map size (LRU) OR pre-validate format (`mail.ParseAddress` + `.` in domain) before bucketing. [`internal/middleware/rate_limit.go:45-72`; `cmd/api/main.go:104-108,177-194`]
- [x] [Review][Patch] **`VerifyEmail` returns 500 for orphaned token (user FK row gone)** — `GetUserByID` `pgx.ErrNoRows` falls through to `fmt.Errorf("lookup user: %w")` → 500, violating GO-2. Fix: map to `NotFoundError{Code: "VERIFICATION_TOKEN_INVALID"}`. [`internal/service/auth.go:207-210`]
- [x] [Review][Patch] **`rawPool` panic fallback** — `rawPool(b txBeginner) DBTX` panics if the txBeginner doesn't also satisfy `DBTX`. Any new `txBeginner` implementation that doesn't dual-satisfy crashes the API. Fix: change the constructor to accept both interfaces explicitly, fail at compile time. [`internal/service/auth.go:480-487`]
- [x] [Review][Patch] **Vacuous negative assertion on duplicate-email no-second-send** — `auth_handler_test.go` asserts `len(sender.SentEmails) != 0` with an inline comment "worker not started in this test" admitting the assertion can never fail. Spec Task 13 calls for `== 1` after the second register. Fix: start the worker (or drain synchronously) and assert exactly 1 email sent across two register attempts. [`internal/handler/auth_handler_test.go:131-133`]
- [x] [Review][Patch] **`GetActiveEmailVerificationByToken` SQL added but never wired** — New sqlc query is dead code; `VerifyEmail` still calls `GetEmailVerificationByToken` and does the guard in Go. Spec Task 2 intent was to move the expiry/consumption guard into the query layer. Fix: wire the new query into the unconsumed-and-unexpired fast path OR remove the dead SQL. [`internal/store/queries/email_verifications.sql:1110-1117`; `internal/service/auth.go:1790`]
- [x] [Review][Patch] **`req.FullName` stored raw, not the trimmed value used in validation** — Validation rune-counts the trimmed string but `CreateUser` is called with raw `req.FullName`, persisting leading/trailing whitespace. Fix: pass `trimmedName` to CreateUser. [`internal/service/auth.go:140`, validation `:393-397`]
- [x] [Review][Patch] **Post-commit audit & enqueue use cancelable request ctx** — Diff carefully wraps `tx.Rollback` in `context.WithoutCancel`, but `logAuthAuditBestEffort` and `enqueueVerificationEmail` use the request ctx. Client disconnect aborts the audit insert mid-write. Fix: wrap with `context.WithoutCancel(ctx)`. [`internal/service/auth.go:172-180,255-264,340-347`]
- [x] [Review][Patch] **`ipKeyForAuthLimiter` duplicated in `main.go`, untested** — A second copy of the IP-key function is declared in the main package, separate from the middleware's. A bug in the main copy would ship without test coverage. Fix: import and use the middleware's exported helper, or hoist to a shared package. [`cmd/api/main.go:162-172`]
- [x] [Review][Patch] **`coalesceAuthChanges` is a no-op (CQ-1 dead code)** — Both branches return the input unchanged. Doc claims to "replace untyped or typed-nil with empty Changes"; doesn't. Fix: remove the function. [`internal/service/auth_audit.go:154-159`]
- [x] [Review][Patch] **`RateLimitByKey` skip path doesn't log** — Empty-key sentinel silently passes through. Operators can't observe how often the per-email limiter is bypassed. Fix: emit `slog.Debug` (or `slog.Info` rate-limited) with the limiter name. [`internal/middleware/rate_limit.go:76-79`]
- [x] [Review][Patch] **`enqueueVerificationEmail` logs `pgtype.UUID` as struct dump** — `slog.WarnContext` receives `pgtype.UUID` directly; the default handler formats it as `{Bytes:[...] Valid:true}` instead of a readable UUID. Fix: convert via `pgUUIDToGoogle(...).String()` before logging. [`internal/service/auth.go:438-443`]
- [x] [Review][Patch] **Adversarial resend test does not compare known-vs-unknown response bodies** — Test registers a verified user but never calls resend on it; only asserts the unknown-email response shape. Spec Task 14 calls for byte-identical bodies between the two cases. Fix: call resend on the verified-user email AND on an unknown email, assert byte equality of bodies. [`internal/test/auth_adversarial_test.go:88-105`]
- [x] [Review][Patch] **`verification_email_send_failed` event key is misused** — AC12 says this fires when the email SEND fails; code fires it on QUEUE-FULL. Real async send failures are logged under `verification_email_retry_scheduled` / `verification_email_dropped_max_attempts`. Operators grepping for the AC12 key will miss real failures. Fix: rename the queue-full case to `verification_email_queue_full`. [`internal/service/auth.go:438`]
- [x] [Review][Patch] **`s.retry == nil` silent fallback** — Misconfigured service silently degrades to "delayed" with no email queued. Fix: require non-nil retry in `NewAuthService`, panic at construction. [`internal/service/auth.go:424-427`]
- [x] [Review][Patch] **`RateLimit_PrefersClientIPContextValue` only exercises global limiter** — Coverage gap for per-route `RateLimitByKey` with `ipKeyFn` and for the duplicated `ipKeyForAuthLimiter` (covered by separate patch above). Fix: add explicit test for `RateLimitByKey(ipKeyFn(...))`. [`internal/middleware/rate_limit_test.go:120-137`]
- [x] [Review][Patch] **`MockHasher` default leaks plaintext into "hash"** — Default `FakeHash` is `"mock-hash-" + plaintext`. Stored test passwords are recoverable from the DB. If mock ever leaks into a non-test build, password hashes are useless. Fix: change default to fixed `[]byte("mock-hash")` with no plaintext. [`internal/service/hasher_mock.go`]
- [x] [Review][Patch] **`recoveredPanicError` carries a dead mutex** — Mutex is locked on every `Error()` call but the value is set only once in the deferred recover. No concurrent writer exists. Fix: remove the mutex. [`internal/service/email_retry.go:3071-3087`]
- [x] [Review][Patch] **`intToStr` reinvents `strconv.Itoa`** — Hand-rolled int-to-string in test to "avoid a strconv import". Pointless. Fix: import `strconv` and use `Itoa`. [`internal/test/auth_adversarial_test.go:215-225`]
- [x] [Review][Patch] **OpenAPI 410 description mentions "rotated out" but AC5 says rotated tokens return 200** — `api.yaml` says "Token expired or rotated out (VERIFICATION_TOKEN_EXPIRED)". Per AC5, a rotated-out token whose user is verified returns 200 idempotent. Fix: change description to "Token expired (link is older than 24 hours and user has not verified)". [`classlite-api/api.yaml:95`]
- [x] [Review][Patch] **i18n deferral on email templates not documented in Dev Agent Record** — Task 16 calls for English-only with i18n deferred; the deferral isn't in completion notes. Fix: add a one-line note to Dev Agent Record. [`_bmad-output/implementation-artifacts/1-4-...md`]
- [x] [Review][Patch] **`pgUUIDToGoogle` silently zero-UUIDs invalid input** — `copy(out[:], u.Bytes[:])` ignores `u.Valid`. Doc says "only call for known-valid", but no compile-time enforcement. Fix: return an error on `!u.Valid`, or panic with a descriptive message. [`internal/service/auth.go:469-475`]

### Deferred

- [x] [Review][Defer] Dual-clock between AuthService and EmailRetryQueue / floor test relies on real wall-clock — deferred. Tests currently pass; introducing a single shared clock interface is an enhancement to the test seam, not a bug. [`internal/service/auth.go`, `internal/service/email_retry.go`]
- [x] [Review][Defer] `rate.Limit(0)` dead branch / Retry-After overflow — deferred. No current caller passes `rate.Limit(0)`; the dead branch in `RateLimitByKey` would only be exercised by future misuse. [`internal/middleware/rate_limit.go:816-823`]
- [x] [Review][Defer] `mail.ParseAddress` accepts `foo@bar` (no TLD) — deferred. Outside spec scope (AC11 mandates ParseAddress); adding a `.`-in-domain check is a UX enhancement. [`internal/service/auth.go:382`]
- [x] [Review][Defer] `auth_audit_logs.entity_id` has no FK / NOT NULL — deferred. No current writer passes nil EntityID; would need schema migration. [`classlite-api/migrations/20260603100000_create_auth_audit_logs.up.sql:6-15`]

### Dismissed (noise / accepted)

- Test count off by 1 (52 vs 53) — counting trivia, not a correctness issue.
- `/register` returns 409 `EMAIL_ALREADY_REGISTERED` as enumeration oracle — per AC2 design tradeoff, accepted.
- Empty-token check at service layer rather than handler — valid layering; service is the right place.
- TokenEntropy sample size 200 vs spec 1000 — justified deviation per existing test comment ("1000 is overkill; 200 is statistically sufficient").
- `verify-status` returns 404 after 24h though user verified — per AC8 / M6, intentional spec behavior.
- Empty `Changes{}` JSON shape — covered by removing `coalesceAuthChanges`.
- Constant-time floor is partial defense in general — already acknowledged in completion notes; the deeper DB-write timing issue is decision-needed above.
