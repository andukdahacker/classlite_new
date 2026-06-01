# Story 1.3: Auth Database Schema & Row-Level Security

Status: done

## Story

As a backend developer,
I want the auth database schema (users, centers, center_members, email_verifications, refresh_tokens, password_resets, invites) with RLS policies and sqlc setup,
so that all auth data is tenant-isolated at the database level and queries are type-safe.

## Acceptance Criteria (BDD)

### AC1: Tables created
Given the migration is applied,
When inspecting the database,
Then all 7 tables exist with correct columns, indexes, and foreign keys,
And all IDs are UUID type,
And all timestamps use timestamptz.

### AC2: RLS null tenant returns zero rows
Given RLS is enabled on all tenant-scoped tables,
When app.current_tenant_id is null or not set,
Then all SELECT, UPDATE, and DELETE queries return zero rows (not an error, not all rows).

### AC3: RLS tenant scoping
Given RLS is enabled,
When app.current_tenant_id is set to a valid center ID,
Then only rows belonging to that center are visible.

### AC4: Adversarial test suite
Given the adversarial test suite runs,
When a query attempts cross-tenant read access,
Then zero rows are returned.

When a query attempts cross-tenant write (UPDATE),
Then zero rows are affected and original data is unchanged.

When app.current_tenant_id is null,
Then zero rows are returned.

When SQL injection is attempted via the tenant ID parameter,
Then it is rejected by parameterized query handling.

### AC5: sqlc generation
Given sqlc is configured,
When sqlc generate is run,
Then type-safe Go query functions are generated for all auth-related queries.

### AC6: Test helpers
Given the internal/test/ package,
When writing integration tests,
Then SetupDB(t) returns a transaction-wrapped DB that auto-rollbacks via t.Cleanup,
And TenantContext(t, db, centerID) sets SET LOCAL and returns a context,
And fixture factories exist for users, centers, and center_members.

## Tasks / Subtasks

- [x] Task 1: Create first migration file (AC: #1)
  - [x] migrations/20260601120000_create_auth_tables.up.sql
  - [x] migrations/20260601120000_create_auth_tables.down.sql
  - [x] Tables: users, centers, center_members, email_verifications, refresh_tokens, password_resets, invites
  - [x] Enable RLS on tenant-scoped tables (center_members, invites — the tables with center_id)
  - [x] users and centers tables: RLS on center_members join, not directly
  - [x] Create indexes: unique on users.email, unique on centers.short_code, composite on tenant-scoped tables
- [x] Task 2: Write RLS policies (AC: #2, #3)
  - [x] Policy: USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid)
  - [x] Null-guard: NULLIF converts empty string to NULL → zero rows returned
  - [x] Policies for SELECT, INSERT, UPDATE, DELETE (ALL + INSERT WITH CHECK)
- [x] Task 3: Write sqlc query files (AC: #5)
  - [x] internal/store/queries/users.sql — GetByID, GetByEmail, GetByGoogleID, Create, UpdateEmailVerified
  - [x] internal/store/queries/centers.sql — GetByID, Create
  - [x] internal/store/queries/center_members.sql — GetByUserAndCenter, Create, ListByCenter
  - [x] internal/store/queries/email_verifications.sql — Create, GetByToken, MarkVerified
  - [x] internal/store/queries/refresh_tokens.sql — Create, GetByTokenHash, Delete, DeleteAllForUser
  - [x] internal/store/queries/password_resets.sql — Create, GetByToken, MarkUsed
  - [x] internal/store/queries/invites.sql — Create, GetByToken, MarkAccepted, ListByCenter
- [x] Task 4: Run sqlc generate (AC: #5)
- [x] Task 5: Create test helpers (AC: #6)
  - [x] internal/test/helpers.go — SetupDB, TenantContext, UUIDString
  - [x] internal/test/fixtures.go — CreateUser, CreateCenter, CreateCenterMember
- [x] Task 6: Write adversarial test suite (AC: #4)
  - [x] internal/test/adversarial_test.go
  - [x] Test cross-tenant read: tenant A cannot see tenant B data (center_members + invites)
  - [x] Test cross-tenant write: tenant A cannot UPDATE tenant B data (center_members + invites)
  - [x] Test null tenant: zero rows returned (center_members + invites)
  - [x] Test unset tenant: zero rows returned (center_members)
  - [x] Test RLS on INSERT, UPDATE, DELETE (not just SELECT) — cross-tenant INSERT, UPDATE, DELETE all tested
  - [x] Deterministic tenant IDs via TenantAID/TenantBID constants (DB-generated UUIDs per test)

### Review Findings

- [x] [Review][Decision] D1: TenantAID/TenantBID — refactored tests to use CreateCenterWithID with deterministic IDs per TEST-BE-1
- [x] [Review][Patch] P1: Fixed misleading comment in migration — email_verifications is not RLS-enabled
- [x] [Review][Patch] P2: Added sync.Once to pool initialization — prevents data race
- [x] [Review][Patch] P3: Fixed getPool fallback URL to use classlite_app (non-superuser) — RLS enforced
- [x] [Review][Patch] P4: Added unique index on refresh_tokens.token_hash via new migration 20260601130000
- [x] [Review][Patch] P5: Updated migrate.sh to use MIGRATION_DATABASE_URL with DATABASE_URL fallback
- [x] [Review][Patch] P6: Added sequence grants via new migration 20260601140000
- [x] [Review][Patch] P7: Added TestRLS_SQLInjection_TenantID — verifies uuid.Parse rejects injection payloads
- [x] [Review][Patch] P8: Fixed TestRLS_Invites_CrossTenantWrite to use raw UPDATE and verify RowsAffected
- [x] [Review][Defer] W1: role column on center_members/invites is unconstrained text — deferred, future schema constraint
- [x] [Review][Defer] W2: short_code has no length/charset CHECK constraint — deferred, future schema constraint
- [x] [Review][Defer] W3: Users table allows both password_hash and google_id to be NULL — deferred, story 1.4
- [x] [Review][Defer] W4: Token-based queries need to work outside tenant context for invite acceptance — deferred, story 1.6
- [x] [Review][Defer] W5: password_resets/email_verifications queries don't filter expired/used — deferred, service layer story 1.4/1.5
- [x] [Review][Defer] W6: refresh_tokens has no revoke query (only hard delete) — deferred, story 1.5

## Dev Notes

### What to create (NEW files)
- `migrations/{timestamp}_create_auth_tables.up.sql`
- `migrations/{timestamp}_create_auth_tables.down.sql`
- `internal/store/queries/users.sql`
- `internal/store/queries/centers.sql`
- `internal/store/queries/center_members.sql`
- `internal/store/queries/email_verifications.sql`
- `internal/store/queries/refresh_tokens.sql`
- `internal/store/queries/password_resets.sql`
- `internal/store/queries/invites.sql`
- `internal/store/generated/` — sqlc output (auto-generated, never hand-edit)
- `internal/test/helpers.go`
- `internal/test/fixtures.go`
- `internal/test/adversarial_test.go`

### Schema design notes

**users table:**
- id (uuid, PK, default gen_random_uuid())
- email (text, unique, not null)
- password_hash (text) — nullable for Google OAuth-only accounts
- full_name (text, not null)
- email_verified (boolean, default false)
- avatar_url (text)
- language_pref (text, default 'vi')
- google_id (text, unique) — for OAuth linking
- created_at (timestamptz, default now())
- updated_at (timestamptz, default now())

**centers table:**
- id (uuid, PK)
- name (text, not null)
- short_code (text, unique, not null)
- brand_color (text)
- logo_url (text)
- timezone (text, default 'Asia/Ho_Chi_Minh')
- google_meet_connected (boolean, default false)
- created_at (timestamptz)

**center_members table (RLS-enabled):**
- user_id (uuid, FK users.id)
- center_id (uuid, FK centers.id)
- role (text, not null) — 'owner', 'admin', 'teacher', 'student'
- created_at (timestamptz)
- PK: (user_id, center_id)

**email_verifications table (RLS via user join):**
- id (uuid, PK)
- user_id (uuid, FK users.id)
- token (text, unique, not null)
- expires_at (timestamptz, not null)
- verified_at (timestamptz)

**refresh_tokens table:**
- id (uuid, PK)
- user_id (uuid, FK users.id)
- token_hash (text, not null)
- family_id (uuid, not null) — for reuse detection
- expires_at (timestamptz, not null)
- revoked_at (timestamptz)
- created_at (timestamptz)

**password_resets table:**
- id (uuid, PK)
- user_id (uuid, FK users.id)
- token (text, unique, not null)
- expires_at (timestamptz, not null)
- used_at (timestamptz)

**invites table (RLS-enabled):**
- id (uuid, PK)
- center_id (uuid, FK centers.id)
- inviter_id (uuid, FK users.id)
- email (text, not null)
- name (text)
- role (text, not null)
- token (text, unique, not null)
- expires_at (timestamptz, not null)
- accepted_at (timestamptz)

### RLS policy pattern
```sql
ALTER TABLE center_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY center_members_tenant_isolation ON center_members
  USING (center_id = NULLIF(current_setting('app.current_tenant_id', true), '')::uuid);
```
The NULLIF + current_setting('...', true) pattern: true means return empty string if not set (instead of error). NULLIF converts empty string to NULL. UUID cast of NULL produces NULL. NULL = anything is false → zero rows returned.

### Critical constraints
- Never DISABLE ROW LEVEL SECURITY in tests (TEST-BE-1)
- Use deterministic test tenant IDs (TEST-BE-1)
- SetupDB wraps in transaction with t.Cleanup rollback (TEST-BE-2)
- Never t.Parallel() on DB tests sharing a transaction
- users and centers are NOT directly RLS-protected (they're global lookups) — but center_members IS
- email_verifications, refresh_tokens, password_resets: scoped by user_id, not center_id (these are pre-tenant-context operations)

### References
- [Source: docs/project-context.md — GO-1, PERF-1, TEST-BE-1, TEST-BE-2, SEC-9]
- [Source: _bmad-output/planning-artifacts/epics.md — Story 1.3]
- [Source: _bmad-output/planning-artifacts/architecture.md — Database Schema]

## Dev Agent Record

### Implementation Plan
1. Created app role migration (non-superuser) to enable RLS enforcement — superusers bypass RLS even with FORCE ROW LEVEL SECURITY
2. Created auth tables migration with all 7 tables, indexes, RLS policies on center_members and invites
3. Wrote sqlc query files for all 7 tables → ran sqlc generate → type-safe Go code generated
4. Built test helpers: SetupDB (transaction-wrapped, auto-rollback), TenantContext (SET LOCAL with SET ROLE to app user)
5. Built fixture factories: CreateUser, CreateCenter, CreateCenterMember
6. Wrote 10 adversarial RLS tests covering cross-tenant read/write/delete/insert + null/unset tenant contexts

### Debug Log
- SET LOCAL does not support parameterized queries ($1) — fixed to use string interpolation with UUID validation
- classlite user is a superuser (bypasses RLS) — created classlite_app non-superuser role, test helper uses SET LOCAL ROLE classlite_app
- email_verifications, refresh_tokens, password_resets lack center_id — RLS via tenant_id not applicable, scoped by user_id at service layer

### Completion Notes
- All 6 tasks completed, all 10 adversarial tests pass, full regression suite passes (0 failures)
- Fixed production bug in store.SetTenantContext: SET LOCAL cannot use $1 params, now uses UUID-validated string interpolation
- Added classlite_app role migration for RLS enforcement in dev/test/production
- Updated .env.example to document separate app vs migration DB URLs

## File List

### New Files
- `classlite-api/migrations/20260601110000_create_app_role.up.sql`
- `classlite-api/migrations/20260601110000_create_app_role.down.sql`
- `classlite-api/migrations/20260601120000_create_auth_tables.up.sql`
- `classlite-api/migrations/20260601120000_create_auth_tables.down.sql`
- `classlite-api/internal/store/queries/users.sql`
- `classlite-api/internal/store/queries/centers.sql`
- `classlite-api/internal/store/queries/center_members.sql`
- `classlite-api/internal/store/queries/email_verifications.sql`
- `classlite-api/internal/store/queries/refresh_tokens.sql`
- `classlite-api/internal/store/queries/password_resets.sql`
- `classlite-api/internal/store/queries/invites.sql`
- `classlite-api/internal/store/generated/db.go` (sqlc generated)
- `classlite-api/internal/store/generated/models.go` (sqlc generated)
- `classlite-api/internal/store/generated/users.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/centers.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/center_members.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/email_verifications.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/refresh_tokens.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/password_resets.sql.go` (sqlc generated)
- `classlite-api/internal/store/generated/invites.sql.go` (sqlc generated)
- `classlite-api/internal/test/helpers.go`
- `classlite-api/internal/test/fixtures.go`
- `classlite-api/internal/test/adversarial_test.go`

### Modified Files
- `classlite-api/internal/store/db.go` — Fixed SetTenantContext to use UUID-validated string interpolation (SET LOCAL cannot use $1)
- `.env.example` — Added MIGRATION_DATABASE_URL, updated DATABASE_URL to use classlite_app

## Change Log
- 2026-06-01: Implemented Story 1.3 — auth database schema, RLS policies, sqlc queries, test helpers, adversarial test suite (10 tests)
