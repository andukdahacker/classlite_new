# Story 1.2b: Database Connection, Health Endpoint & Tenant Context

Status: done

## Story

As a backend developer,
I want a pgx connection pool, a health endpoint that reports DB connectivity, and a per-request tenant context function,
so that the API can connect to PostgreSQL reliably, operators can monitor health, and every query runs in the correct tenant scope.

## Acceptance Criteria (BDD)

### AC1: Pool wired into main.go
Given the API starts with a valid DATABASE_URL,
When the pgx pool initializes,
Then the pool connects successfully and is reusable across requests,
And if DATABASE_URL is empty or connection fails, the server logs the error and exits.

### AC2: Health endpoint reports DB status
Given GET /api/health is called,
When the database is reachable,
Then response is 200 with {"status":"ok","db":"connected"}.

Given GET /api/health is called,
When the database is unreachable,
Then response is 503 with {"status":"degraded","db":"disconnected"}.

### AC3: Tenant context helper
Given a TenantContext with a valid CenterID,
When SetTenantContext(ctx, pool, tc) is called within a transaction,
Then SET LOCAL app.current_tenant_id = '{center_id}' is executed on the connection.

### AC4: TenantContext context keys
Given the ctxkey package,
When inspecting exported keys,
Then TenantID, UserID, and Role context keys exist alongside RequestID.

## Tasks / Subtasks

- [x] Task 1: Wire store.NewPool into main.go (AC: #1)
  - [x] Call store.NewPool(ctx, cfg.DatabaseURL) at startup
  - [x] If error, log and os.Exit(1)
  - [x] defer pool.Close() in main
  - [x] Pass pool to HealthHandler
- [x] Task 2: Upgrade HealthHandler to check DB (AC: #2)
  - [x] Add Pool field to HealthHandler struct
  - [x] pool.Ping(ctx) to check connectivity
  - [x] Return {"status":"ok","db":"connected"} or {"status":"degraded","db":"disconnected"} with 503
- [x] Task 3: Create SetTenantContext in store/db.go (AC: #3)
  - [x] func SetTenantContext(ctx context.Context, tx pgx.Tx, tc model.TenantContext) error
  - [x] Execute: SET LOCAL app.current_tenant_id = $1
  - [x] Parameterized query, never string interpolation
- [x] Task 4: Add context keys to model/ctxkey.go (AC: #4)
  - [x] Add TenantID, UserID, Role context keys

### Review Findings

- [x] [Review][Patch] Nil `tx` in `SetTenantContext` causes panic — fixed: added nil guard [store/db.go]
- [x] [Review][Patch] Nil `Pool` in `HealthHandler.Check` causes panic — fixed: nil check before Ping [health_handler.go]
- [x] [Review][Patch] Health check `Pool.Ping` has no timeout — fixed: 2s context timeout via `pingDB` helper [health_handler.go]
- [x] [Review][Patch] `map[bool]string{...}` trick for status is non-idiomatic Go — fixed: simple if/else with separate statusText var [health_handler.go]
- [x] [Review][Defer] Empty JWT secret silently accepted at startup — deferred to story 1.2c (config validation)
- [x] [Review][Defer] CORS before RateLimit allows unlimited preflight flood — architectural, already noted in 1.2a
- [x] [Review][Defer] `os.Exit` in ListenAndServe goroutine skips defers — pre-existing from story 1.1

## Dev Notes

### What exists (UPDATE files)
- `internal/store/db.go` -- NewPool exists but not called. Add SetTenantContext function.
- `internal/handler/health_handler.go` -- HealthHandler has no fields. Add *pgxpool.Pool field, update Check method.
- `cmd/api/main.go` -- Add pool init, pass to handler, defer close.
- `internal/model/ctxkey.go` -- Only has RequestID. Add TenantID, UserID, Role.

### Critical constraints
- pgx v5 only (GO-6). Use pgxpool.Pool, not database/sql.
- SET LOCAL requires explicit transaction (PERF-1) -- the helper operates on pgx.Tx, not raw pool.
- Never use string interpolation for tenant_id -- use parameterized $1 (SQL injection prevention).
- TenantContext is NOT extracted from JWT yet (that's story 1.4+). This story creates the DB-level helper.

### References
- [Source: docs/project-context.md -- GO-1, GO-6, PERF-1, GFW-4]
- [Source: _bmad-output/planning-artifacts/epics.md -- Story 1.2b]

## Dev Agent Record

### Agent Model Used
Claude Opus 4.6 (1M context)

### Debug Log References
N/A — clean implementation, no issues encountered.

### Completion Notes List
- Pool wired into main.go: connects on startup, exits on failure, deferred Close, passed to HealthHandler.
- HealthHandler upgraded: Pool field added, Ping check returns 200+ok/connected or 503+degraded/disconnected. 2 tests (connected + disconnected).
- SetTenantContext: parameterized SET LOCAL on pgx.Tx, validates non-empty CenterID. 1 test (empty CenterID).
- Context keys: TenantID, UserID, Role added alongside RequestID in ctxkey.go.
- NewPool empty URL test added. Total 4 new tests, 14 total across project.
- All tests pass with -race flag. go vet clean.

### File List
- classlite-api/cmd/api/main.go (MODIFIED — pool init, defer close, pass to handler)
- classlite-api/internal/handler/health_handler.go (MODIFIED — Pool field, DB ping check, 200/503 response)
- classlite-api/internal/handler/health_handler_test.go (NEW — connected + disconnected tests)
- classlite-api/internal/store/db.go (MODIFIED — added SetTenantContext, removed stub comment)
- classlite-api/internal/store/db_test.go (NEW — empty URL + empty CenterID tests)
- classlite-api/internal/model/ctxkey.go (MODIFIED — added TenantID, UserID, Role keys)
