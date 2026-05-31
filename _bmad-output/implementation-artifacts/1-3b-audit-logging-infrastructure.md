# Story 1.3b: Audit Logging Infrastructure

Status: ready-for-dev

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

- [ ] Task 1: Create migration for audit_logs table (AC: #1, #2)
  - [ ] migrations/{YYYYMMDDHHMMSS}_create_audit_logs.up.sql
  - [ ] migrations/{YYYYMMDDHHMMSS}_create_audit_logs.down.sql
  - [ ] Create table with all specified columns
  - [ ] Enable RLS with tenant isolation policy
  - [ ] Create composite index on (center_id, entity_type, created_at)
- [ ] Task 2: Write sqlc queries for audit_logs (AC: #3)
  - [ ] internal/store/queries/audit_logs.sql — Insert, ListByEntity, ListByCenter
- [ ] Task 3: Run sqlc generate
- [ ] Task 4: Create internal/service/audit.go (AC: #3)
  - [ ] AuditService struct with store dependency
  - [ ] Log(ctx, tc TenantContext, action, entityType string, entityID uuid.UUID, changes any) error
  - [ ] Extract IP from context (set by middleware)
  - [ ] changes serialized as JSONB with before/after structure
- [ ] Task 5: Add IP extraction to request context
  - [ ] Either via existing middleware or new helper
  - [ ] Add IPAddress context key to ctxkey.go

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
