# Story 1.3b: Audit Logging Infrastructure

Status: done

## Story

As a developer,
I want an audit log table and service that records who changed what and when,
so that multi-tenant billing and enrollment changes are traceable.

## Acceptance Criteria (BDD)

### AC1: Audit logs table
Given the migration is applied,
When inspecting the database,
Then the audit_logs table exists with columns: id (uuid), center_id (uuid), user_id (uuid), action (text), entity_type (text), entity_id (uuid), changes (JSONB with before/after), ip_address (text), created_at (timestamptz).

### AC2: RLS on audit_logs
Given RLS is enabled on audit_logs,
When app.current_tenant_id is null or set to a different center,
Then audit records from other tenants are not visible.

### AC3: Audit service
Given the audit service in internal/service/audit.go is initialized,
When Log(ctx, action, entityType, entityID, changes) is called,
Then a row is inserted into audit_logs with the current user ID, center ID, and IP address derived from the request context.

### AC4: Efficient querying
Given the audit_logs table has data,
When querying by center, entity type, and date range,
Then the query uses the composite index on (center_id, entity_type, created_at) efficiently.

## Tasks / Subtasks

- [x] Task 1: Create migration for audit_logs table (AC: #1, #2)
  - [x] migrations/20260603000000_create_audit_logs.up.sql
  - [x] migrations/20260603000000_create_audit_logs.down.sql
  - [x] Create table with all specified columns
  - [x] Enable RLS with tenant isolation policy (NULLIF pattern + FORCE; INSERT WITH CHECK; no UPDATE/DELETE policies → append-only)
  - [x] Create composite index on (center_id, entity_type, created_at DESC)
- [x] Task 2: Write sqlc queries for audit_logs (AC: #3)
  - [x] internal/store/queries/audit_logs.sql — InsertAuditLog, ListAuditLogsByEntity, ListAuditLogsByCenter
- [x] Task 3: Run sqlc generate
- [x] Task 4: Create internal/service/audit.go (AC: #3)
  - [x] AuditService struct with transaction-capable pool dependency
  - [x] Log(ctx, tc TenantContext, action, entityType string, entityID uuid.UUID, changes any) error
  - [x] Extract IP from context (set by ClientIP middleware)
  - [x] changes serialized as JSONB with before/after structure (`service.Changes` type)
- [x] Task 5: Add IP extraction to request context
  - [x] New ClientIP middleware (X-Forwarded-For leftmost, fallback to RemoteAddr host portion)
  - [x] Added model.IPAddress context key to ctxkey.go
  - [x] Wired into the main.go middleware chain after RequestID

## Dev Notes

### What to create (NEW files)
- `migrations/{timestamp}_create_audit_logs.up.sql`
- `migrations/{timestamp}_create_audit_logs.down.sql`
- `internal/store/queries/audit_logs.sql`
- `internal/service/audit.go`

### What exists (UPDATE files)
- `internal/model/ctxkey.go` — add IPAddress context key
- Potentially `internal/middleware/request_id.go` or new middleware for IP extraction

### Changes JSONB structure
```json
{
  "before": { "role": "teacher" },
  "after": { "role": "admin" }
}
```
Only include fields that changed, not the entire entity.

### Critical constraints
- Audit logs are append-only — never UPDATE or DELETE audit records
- RLS uses same NULLIF pattern as story 1.3
- AuditService accepts TenantContext (GO-1) — no exception
- IP extraction: use r.RemoteAddr or X-Forwarded-For (behind Railway proxy)
- This migration MUST have a higher timestamp than 1.3's migration

### Dependencies
- Story 1.3 must be complete (auth tables migration runs first)
- Story 1.2b (SetTenantContext helper for transactions)

### References
- [Source: docs/project-context.md — GO-1, NFR-6]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.3b]

## Dev Agent Record

### Implementation Plan
- Append-only audit_logs table with RLS mirroring the 1.3 NULLIF + FORCE pattern, but only `USING` (read) and `INSERT WITH CHECK` policies — no UPDATE/DELETE policies enforces the append-only invariant at the RLS layer.
- Composite index ordered `(center_id, entity_type, created_at DESC)` matches both query shapes (`ListAuditLogsByEntity` and `ListAuditLogsByCenter`) and supports `ORDER BY created_at DESC` without a sort node.
- `service.AuditService` opens its own transaction per Log call (PERF-1) and applies `SET LOCAL app.current_tenant_id` via existing `store.SetTenantContext`. Depends on a `txBeginner` interface so production wires `*pgxpool.Pool` and tests wire `*test.TxDB` (savepoint-backed).
- IP extraction is a dedicated `middleware.ClientIP` rather than overloading RequestID — keeps responsibilities separable and lets tests target it directly. Leftmost X-Forwarded-For with `r.RemoteAddr` host fallback matches Railway's proxy chain semantics.

### Completion Notes
- AC1 verified by successful migration application (`scripts/migrate.sh up` — 20260603000000/u create_audit_logs).
- AC2 verified by 4 RLS adversarial tests (cross-tenant read, cross-tenant insert rejection, null tenant, unset tenant) — all PASS.
- AC3 verified by 2 happy-path service tests (with IP, without IP) + 4 validation-guard tests.
- AC4 verified by `TestAuditLogs_CompositeIndexUsed` parsing `EXPLAIN` output and asserting `idx_audit_logs_center_entity_created` is selected.
- Full project test suite: PASS across all packages, no regressions.

### File List
- `classlite-api/migrations/20260603000000_create_audit_logs.up.sql` — NEW
- `classlite-api/migrations/20260603000000_create_audit_logs.down.sql` — NEW
- `classlite-api/internal/store/queries/audit_logs.sql` — NEW
- `classlite-api/internal/store/generated/audit_logs.sql.go` — NEW (sqlc-generated)
- `classlite-api/internal/store/generated/models.go` — UPDATED (sqlc added `AuditLog` struct)
- `classlite-api/internal/service/audit.go` — NEW
- `classlite-api/internal/service/audit_test.go` — NEW
- `classlite-api/internal/service/audit_test_helpers_test.go` — NEW
- `classlite-api/internal/middleware/client_ip.go` — NEW
- `classlite-api/internal/middleware/client_ip_test.go` — NEW
- `classlite-api/internal/model/ctxkey.go` — UPDATED (added IPAddress key)
- `classlite-api/cmd/api/main.go` — UPDATED (wired ClientIP into middleware chain)
- `classlite-api/internal/test/audit_logs_rls_test.go` — NEW (RLS adversarial tests)

### Change Log
- 2026-06-03: Initial implementation of Story 1.3b — audit_logs table, RLS, sqlc queries, AuditService, ClientIP middleware, and adversarial tests.
- 2026-06-03: Applied 12 code-review patches — explicit `ON DELETE RESTRICT` on FKs, `REVOKE UPDATE/DELETE/TRUNCATE` for defence-in-depth append-only, `ValidationError` typed errors in `AuditService.Log`, typed-nil coalescing in `Changes`, `context.WithoutCancel` rollback, ClientIP IP validation + leading-comma + IPv6:port handling, `SET LOCAL enable_seqscan = off` in index test, fixed per-entity assertion in cross-tenant read test, added UPDATE/DELETE/TRUNCATE-denied tests, added INSERT-unset-tenant-rejected test, expanded ClientIP tests to 10 cases. Full suite still passes.

### Review Findings
- [x] [Review][Patch] FK `audit_logs.user_id` / `center_id` — make `ON DELETE RESTRICT` explicit (decision: option A — maximal evidence retention) [migrations/20260603000000_create_audit_logs.up.sql:7-8]
- [x] [Review][Patch] AuditService validation guards use `fmt.Errorf` instead of typed `model.ValidationError` (GO-2) [classlite-api/internal/service/audit.go:53-69]
- [x] [Review][Patch] `TestRLS_AuditLogs_CrossTenantRead` calls `ListAuditLogsByEntity` with a fresh random entity UUID and discards the result via `_ = rowsA` — the per-entity assertion never executes [classlite-api/internal/test/audit_logs_rls_test.go:582-591]
- [x] [Review][Patch] `TestAuditLogs_CompositeIndexUsed` is flaky — 20 rows is too few for the planner to prefer the index over seqscan [classlite-api/internal/test/audit_logs_rls_test.go:686-731]
- [x] [Review][Patch] `extractClientIP` does no IP format validation — attacker-controlled headers land in `audit_logs.ip_address` unchecked (spoofable, log-injection vector) [classlite-api/internal/middleware/client_ip.go:33-43]
- [x] [Review][Patch] Leading-comma X-Forwarded-For (`", 1.2.3.4"`) silently records the proxy RemoteAddr instead of the real client IP [classlite-api/internal/middleware/client_ip.go:33-43]
- [x] [Review][Patch] `defer tx.Rollback(ctx)` uses an already-canceled ctx when the request is canceled mid-tx — rollback never reaches the server and the connection is destroyed instead of recycled [classlite-api/internal/service/audit.go:96]
- [x] [Review][Patch] Append-only invariant is not defended in depth — migration omits explicit `REVOKE UPDATE, DELETE, TRUNCATE ON audit_logs FROM classlite_app`, and no test asserts those operations fail [migrations/20260603000000_create_audit_logs.up.sql]
- [x] [Review][Patch] Missing test: in-tenant `UPDATE` and `DELETE` against `audit_logs` must return 0 rows affected (proves append-only at RLS layer) [classlite-api/internal/test/audit_logs_rls_test.go]
- [x] [Review][Patch] Missing test: `InsertAuditLog` with unset tenant context must be rejected by `WITH CHECK` policy [classlite-api/internal/test/audit_logs_rls_test.go]
- [x] [Review][Patch] IPv6 multi-hop X-Forwarded-For with bracketed `host:port` form is stored verbatim with brackets and port [classlite-api/internal/middleware/client_ip.go:33-43]
- [x] [Review][Patch] `changes any` accepts a typed-nil pointer that bypasses the `if changes == nil` guard and marshals to `"null"` instead of `{}` [classlite-api/internal/service/audit.go:71-79]
- [x] [Review][Defer] Rate limiter still keys on `r.RemoteAddr`, not the new `model.IPAddress` ctx [classlite-api/internal/middleware/rate_limit.go] — deferred, pre-existing bug exposed by this story; tracked in deferred-work.md W1
- [x] [Review][Defer] Composite index doesn't include `entity_id` — per-entity timeline queries scale linearly with tenant history [migrations/20260603000000_create_audit_logs.up.sql:17-18] — deferred, spec AC4 prescribed the current shape; tracked as W2
- [x] [Review][Defer] No idempotency key on `audit_logs` — commit-after-INSERT race can produce duplicates if the caller retries [classlite-api/internal/service/audit.go] — deferred, requires request_id plumbing not yet present; tracked as W3
- [x] [Review][Defer] `ip_address text` rather than `inet` — DB-level IP validation and range queries unavailable [migrations/20260603000000_create_audit_logs.up.sql:11] — deferred, spec explicitly specifies `text`; tracked as W4
