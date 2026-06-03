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
