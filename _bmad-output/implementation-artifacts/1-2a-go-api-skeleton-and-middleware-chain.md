# Story 1.2a: Go API Skeleton & Middleware Chain

Status: done

## Story

As a backend developer,
I want a Go API entry point with request_id, logger, CORS, and rate_limit middleware wired in the correct order,
so that every request is traceable, logged, access-controlled, and rate-limited before reaching any handler.

## Acceptance Criteria (BDD)

### AC1: CORS middleware
Given any incoming HTTP request with an Origin header,
When the Origin matches cfg.CORSOrigins allowlist,
Then Access-Control-Allow-Origin is set to the matched origin (not *),
And Access-Control-Allow-Credentials is true,
And Vary: Origin is always set (Cloudflare caching),
And preflight OPTIONS returns 204 with correct headers.

Given an Origin NOT in the allowlist,
When the request arrives,
Then no CORS headers are set, request proceeds without CORS response headers.

### AC2: Rate-limit middleware
Given the rate limiter is configured,
When requests from the same IP exceed the default threshold (200 req/min),
Then a 429 Too Many Requests response is returned with Retry-After header,
And the response uses the standard error envelope.

### AC3: Middleware chain order
Given the middleware chain is wired in main.go,
When inspecting the wrapping order,
Then the order is: request_id -> logger -> cors -> rate_limit -> router.

### AC4: Logger middleware
Given any HTTP request passing through the middleware chain,
When the response is written,
Then slog logs method, path, status code, duration, and request_id.

## Tasks / Subtasks

- [x] Task 1: Create internal/middleware/cors.go (AC: #1)
  - [x] Parse cfg.CORSOrigins into map[string]bool
  - [x] Handle preflight OPTIONS with 204
  - [x] Set Allow-Origin, Allow-Credentials, Allow-Methods, Allow-Headers, Vary
  - [x] Accept allowedOrigins string as constructor parameter
- [x] Task 2: Create internal/middleware/rate_limit.go (AC: #2)
  - [x] In-memory token bucket per IP (use golang.org/x/time/rate)
  - [x] Configurable rate/burst, default 200 req/min
  - [x] Return 429 with standard error envelope and Retry-After header
  - [x] Cleanup stale entries with mutex-protected map + periodic goroutine
- [x] Task 3: Create internal/middleware/logger.go (AC: #4)
  - [x] Wrap ResponseWriter to capture status code
  - [x] Log method, path, status, duration_ms, request_id via slog
- [x] Task 4: Wire middleware chain in main.go (AC: #3)
  - [x] Order: RequestID -> Logger -> CORS -> RateLimit -> mux
  - [x] Pass cfg.CORSOrigins to CORS middleware constructor
- [x] Task 5: Add golang.org/x/time dependency to go.mod

### Review Findings

- [x] [Review][Patch] `extractIP` misuses `net.SplitHostPort` on X-Forwarded-For — fixed: parse comma-separated list, take first entry, trim whitespace [rate_limit.go:84-91]
- [x] [Review][Patch] `deploy.yml` accidentally removed `deploy-api` job and CI-API trigger — restored [.github/workflows/deploy.yml]
- [x] [Review][Patch] Rate-limit burst=10 undershoots the 200 req/min AC2 spec — fixed: burst set to 200 [main.go:34]
- [x] [Review][Patch] Logger uses `slog.Info` instead of `slog.InfoContext` — fixed [logger.go:30]
- [x] [Review][Patch] `json.Encode` error silently discarded in rate-limit 429 response — fixed: log on failure [rate_limit.go:66]
- [x] [Review][Defer] Cleanup goroutine in RateLimit has no shutdown mechanism — acceptable for MVP (single process lifetime), add context cancellation when needed
- [x] [Review][Defer] statusWriter doesn't implement http.Flusher/Hijacker — no SSE/WebSocket in MVP, revisit if streaming endpoints are added
- [x] [Review][Defer] 429 response uses inline map instead of shared envelope type — shared response helpers don't exist yet (story 1.2c will create them)
- [x] [Review][Defer] Vary: Origin uses Set instead of Add, could overwrite other Vary values — no other Vary headers exist currently, revisit when adding compression middleware

## Dev Notes

### What exists (UPDATE files)
- `cmd/api/main.go` -- currently wraps mux with RequestID only. Add Logger, CORS, RateLimit wrapping.
- `internal/middleware/request_id.go` -- done, no changes needed.
- `internal/config/config.go` -- CORSOrigins already loaded as string. May need to add RateLimit config fields.

### What to create (NEW files)
- `internal/middleware/cors.go`
- `internal/middleware/rate_limit.go`
- `internal/middleware/logger.go`

### Critical constraints
- Middleware signature: `func(next http.Handler) http.Handler` -- always http.Handler, never http.HandlerFunc (GFW-2)
- No third-party HTTP router -- stdlib net/http only
- CORS: never wildcard origin with credentials (SEC-5)
- Rate limit: in-memory is fine for MVP (single Railway instance); PostgreSQL-backed in story 1.5

### References
- [Source: docs/project-context.md -- SEC-5, SEC-10, GFW-2]
- [Source: _bmad-output/planning-artifacts/epics.md -- Story 1.2a]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
- Fixed `net.SplitHostPort` returning 3 values — used error return instead of ok boolean pattern.
- Removed duplicate request log from `request_id.go` since Logger middleware now handles all request logging.

### Completion Notes List
- CORS middleware: explicit allowlist matching (never wildcard), Vary: Origin always set, preflight 204 with all required headers. 4 tests.
- Rate limiter: in-memory token bucket per IP using golang.org/x/time/rate. Stale entries cleaned every minute. X-Forwarded-For support for Railway proxy. Standard error envelope on 429. 4 tests.
- Logger middleware: statusWriter wrapper captures status code. Logs method, path, status, duration_ms, request_id. 2 tests.
- Middleware chain wired in main.go: RequestID → Logger → CORS → RateLimit → mux.
- Removed duplicate log from request_id.go to avoid double-logging.
- All 10 tests pass with -race flag. go vet clean.

### File List
- classlite-api/internal/middleware/cors.go (NEW)
- classlite-api/internal/middleware/cors_test.go (NEW)
- classlite-api/internal/middleware/rate_limit.go (NEW)
- classlite-api/internal/middleware/rate_limit_test.go (NEW)
- classlite-api/internal/middleware/logger.go (NEW)
- classlite-api/internal/middleware/logger_test.go (NEW)
- classlite-api/internal/middleware/request_id.go (MODIFIED — removed duplicate log, removed unused slog import)
- classlite-api/cmd/api/main.go (MODIFIED — wired full middleware chain)
- classlite-api/go.mod (MODIFIED — added golang.org/x/time)
- classlite-api/go.sum (MODIFIED)
