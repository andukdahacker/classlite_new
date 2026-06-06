# Deferred Work

## Deferred from: code review of story-1-1 (2026-05-29)

- No validation that critical config values (JWT_SECRET, DATABASE_URL) are set — server starts with empty strings. Wire startup validation in story 1.3 when DB pool is connected.
- Missing ESLint import boundary rules (`no-restricted-imports`) — no features exist yet to enforce boundaries on. Add when first cross-feature import is possible.
- Unpinned third-party GitHub Action `bervProject/railway-deploy@main` — pin to a specific commit SHA before first production deploy to prevent supply-chain attacks.

## Deferred from: code review of story-1-2a (2026-05-30)

- RateLimit cleanup goroutine has no shutdown mechanism (no context cancellation) — acceptable for MVP single-process lifetime, add when needed for test isolation or multi-instance.
- statusWriter doesn't implement http.Flusher/Hijacker interfaces — no SSE/WebSocket in MVP, revisit when streaming endpoints are added.
- 429 rate-limit response uses inline map[string]any instead of shared envelope type — shared response helpers will be created in story 1.2c; refactor to use them then.
- CORS middleware uses `Set("Vary", "Origin")` instead of `Add` — could overwrite other Vary headers; no other Vary sources exist currently, revisit when adding compression middleware.

## Deferred from: code review of story-1-2b (2026-05-30)

- Empty JWT secret silently accepted at startup — config validation deferred to story 1.2c.
- CORS wraps RateLimit, allowing unlimited preflight OPTIONS flood without rate limiting — architectural decision, reconsider if CORS abuse becomes a concern.
- `os.Exit` in ListenAndServe goroutine skips `defer` cleanup in main — pre-existing from story 1.1, refactor to channel-based error propagation when adding more cleanup logic.

## Deferred from: code review of story-1-2c (2026-05-31)

- Double WriteHeader if handler writes response then panics or returns error — needs tracked ResponseWriter wrapper; add when handler complexity warrants it.
- Config Validate allows arbitrary APP_ENV values (typos like "dev" or "prod" not caught) — add allowlist when more environments are defined.
- Empty CORS_ORIGINS env var edge case — already handled by CORS middleware parseOrigins which filters empty strings.

## Deferred from: code review of story-1-2d (2026-05-31)

- No context timeout in EmailSender.Send — caller responsibility; workers should set their own timeouts via context.WithTimeout.

## Deferred from: code review of story-1-2e (2026-05-31)

- HeadObject errors all mapped to 404 — should distinguish R2 network/auth errors from actual not-found; add S3 error type checking when needed.
- No max-size constraint on presigned PUT — R2/S3 doesn't enforce content-length in presigned URLs the same way; validate file size post-upload in confirm endpoint.

## Deferred from: code review of story-1-3 (2026-06-01)

- W1: `role` column on center_members/invites is unconstrained text — add CHECK constraint or enum when role definitions stabilize.
- W2: `short_code` on centers has no length/charset CHECK constraint — add validation when onboarding flow is built (story 2.1).
- W3: Users table allows both `password_hash` and `google_id` to be NULL (no auth method) — enforce at least one auth method at service layer in story 1.4.
- W4: Token-based queries (GetInviteByToken, GetEmailVerificationByToken, GetPasswordResetByToken) need to work outside tenant context for unauthenticated flows — design decision for invite acceptance (story 1.6) and verification (story 1.4).
- W5: password_resets/email_verifications queries don't filter on `expires_at` or `used_at`/`verified_at` — enforce at service layer in stories 1.4/1.5.
- W6: refresh_tokens has no revoke-by-setting-revoked_at query (only hard delete) — needed for token reuse detection family tracking in story 1.5.

## Deferred from: code review of story-1-3b (2026-06-03)

- W1 (HIGH): RateLimit middleware still keys on `r.RemoteAddr` instead of the new `model.IPAddress` context key — pre-existing bug exposed by adding ClientIP middleware. Behind Railway/Cloudflare every real user collapses into one rate-limit bucket per proxy egress IP. Fix in a follow-up that updates `internal/middleware/rate_limit.go` to read `r.Context().Value(model.IPAddress).(string)` first, fall back to `r.RemoteAddr`.
- W2 (MED): Composite index `(center_id, entity_type, created_at DESC)` does NOT include `entity_id`, so `ListAuditLogsByEntity` does a range scan + in-memory filter for high-volume entity types — within spec AC4, but a perf enhancement to add `(center_id, entity_type, entity_id, created_at DESC)` may be needed once audit volume grows.
- W3 (MED): Audit insert/commit has no idempotency key — if commit ack is lost the caller retries and produces a duplicate audit row. Add unique partial index on `(center_id, request_id)` and pass request_id through `AuditService.Log` when the rest of the request pipeline is fully wired.
- W4 (LOW): `audit_logs.ip_address` is `text`, not `inet` — spec explicitly says `text`, so code matches spec. Revisit if log-injection or IP-range queries become a need.

## Deferred from: code review of story-1-4 (2026-06-04)

- Resend constant-time floor is one-sided (DB-write path can exceed 200 ms while unknown-email path is padded to ~200 ms, leaving a statistical timing channel) — per-IP (burst 5, 1/2 min) and per-email (1/60 s) rate limits cap sampling rate; statistical separation needs hundreds-to-thousands of samples per address, making the residual timing leak impractical to exploit at scale. Revisit only if abuse is observed.
- Dual-clock between AuthService and EmailRetryQueue / floor test relies on real wall-clock — tests pass; a single shared `clock` interface across both layers would tighten the test seam (deterministic floor verification) but is not a bug today.
- `rate.Limit(0)` dead branch in `RateLimitByKey` / Retry-After overflow — no current caller passes zero rate; tighten when a new caller forces the issue.
- `mail.ParseAddress` accepts addresses like `foo@bar` (no TLD) — outside Story 1.4 scope (AC11 mandates ParseAddress). Add a `.`-in-domain check or MX-lookup when a real abuse case appears.
- `auth_audit_logs.entity_id` has no FK constraint and is nullable — no current writer passes nil EntityID; tighten to `NOT NULL` (and optionally a soft FK to users.id) in a follow-up schema migration.

## Deferred from: story-1-5 (2026-06-06)

- W1 (MED): Replace in-process token-bucket rate-limiter (`golang.org/x/time/rate` + per-process map) with a PG-backed implementation when ClassLite moves to multi-instance Railway deploys. Architecture spec: `rate_limits(key VARCHAR PK, count INTEGER, window_start TIMESTAMPTZ, expires_at TIMESTAMPTZ)` with periodic cleanup. Single-dyno MVP is unaffected.
- W2 (LOW): Single-membership auto-binding into JWT claims (`center_id`/`role` populated only when the user has exactly one active `center_members` row) is a stop-gap. Epic 2 introduces a real membership-select endpoint that replaces the heuristic; remove the inline `SELECT COUNT(*)` + `SELECT center_id, role` pair in `service.buildAccessToken` when that lands.
- W3 (LOW): Login attempt records on the success path INSERT a `success=true` row inside the same tx, then immediately `DeleteLoginAttemptsByEmail` removes BOTH success and failure rows — the success row is therefore effectively never persisted. Either remove the redundant insert OR keep success rows separately for analytics; revisit when login analytics ship.
- W4 (LOW): Password-reset email is sent synchronously via `s.email.Send` (not the retry queue) so the ATDD test sees the dispatch without driving a worker. If Resend throughput becomes a constraint, route this through `EmailRetryQueue` and update tests to drain explicitly.
- ~~W5: rate-limit burst masked ACCOUNT_LOCKED~~ — CLOSED 2026-06-06 by bumping `auth-login` burst from 5 to 8 in `cmd/api/main.go`. ACCOUNT_LOCKED now surfaces at the HTTP edge with `Retry-After: 900`; verified by re-running the lockout smoke test.

## Deferred from: code review of story-1-5 (2026-06-06)

- Client-disconnect during refresh rotation triggers family revocation on retry (`auth_refresh.go`) — design property of strict reuse detection; AC8 mandates "force re-login on every device." Add a grace window (keep rotated-out row revoked for ~30s, allow same-hash replay if successor was created within window) only if observed in prod.
- `OriginCheck` rejects every state-mutating POST without an `Origin` header (`middleware/origin_check.go`) — Story 1.5 has no native-mobile / S2S / monitoring surface so the rejection is invisible today. Revisit when those surfaces arrive; either accept empty Origin when a server-side trust signal is present (mTLS, API key), or carve out bearer-authed routes (no CSRF surface).
- `LastFailedLoginAttempt` SQL has no time bound (`internal/store/queries/login_attempts.sql`) — works today because lockout enforcement happens in Go. Add `AND attempted_at > $2` parameter when retention / cleanup cron arrives.
- CORS wildcard regex (`^https://[a-zA-Z0-9-]+\.classlite\.app$`) doesn't normalize default ports in Origin (`middleware/cors.go`) — rare browser behavior (some include `:443`); document and strip ports before match if observed.
- `CountSiblingsInFamily` doesn't filter `revoked_at IS NULL` (`internal/store/queries/refresh_tokens.sql`) — consistent with the hard-delete revocation pattern story 1.5 uses. Revisit if soft-delete-on-revoke is reintroduced.
- CORS wildcard accepts `http://*.classlite.app` (insecure scheme) (`middleware/cors.go`) — operator error in environment; tighten to `https://` only when `AllowCredentials=true`.
- `_ = err` swallowing across audit / login-attempt / logout / forgot-password paths reduces operational visibility — broad cleanup; add throttled `slog.Warn` on persistent failures so a DB / audit outage doesn't go unseen.
- `auth_p2_test.go` and `auth_role_negative_test.go` depend on ATDD-only helper functions (`newAuthServiceWithSenderAccess`, etc.) — test hygiene; consolidate when the helpers are extracted into a shared `internal/testsupport` package.

## Closed by story-1-5

- W5 from story-1-3 (`password_resets`/`email_verifications` need expires_at/used_at filter): `GetActivePasswordResetByToken` now filters in-SQL. `email_verifications` queries are scoped to their use cases.
- W6 from story-1-3 (refresh_tokens has no revoke-by-revoking-revoked_at query): closed via `DeleteRefreshTokensByFamily` — story 1.5 uses hard deletes to revoke, not the `revoked_at` column.
