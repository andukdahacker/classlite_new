# Story 1.3: Auth Database Schema & Row-Level Security

Status: ready-for-dev

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

- [ ] Task 1: Create first migration file (AC: #1)
  - [ ] migrations/{YYYYMMDDHHMMSS}_create_auth_tables.up.sql
  - [ ] migrations/{YYYYMMDDHHMMSS}_create_auth_tables.down.sql
  - [ ] Tables: users, centers, center_members, email_verifications, refresh_tokens, password_resets, invites
  - [ ] Enable RLS on tenant-scoped tables (center_members, email_verifications, refresh_tokens, password_resets, invites)
  - [ ] users and centers tables: RLS on center_members join, not directly
  - [ ] Create indexes: unique on users.email, unique on centers.short_code, composite on tenant-scoped tables
- [ ] Task 2: Write RLS policies (AC: #2, #3)
  - [ ] Policy: USING (center_id = current_setting('app.current_tenant_id')::uuid)
  - [ ] Null-guard: coalesce or explicit null check to return zero rows on unset
  - [ ] Policies for SELECT, INSERT, UPDATE, DELETE
- [ ] Task 3: Write sqlc query files (AC: #5)
  - [ ] internal/store/queries/users.sql — GetByID, GetByEmail, Create, UpdateEmailVerified
  - [ ] internal/store/queries/centers.sql — GetByID, Create
  - [ ] internal/store/queries/center_members.sql — GetByUserAndCenter, Create, ListByCenter
  - [ ] internal/store/queries/email_verifications.sql — Create, GetByToken, MarkVerified
  - [ ] internal/store/queries/refresh_tokens.sql — Create, GetByTokenHash, Delete, DeleteAllForUser
  - [ ] internal/store/queries/password_resets.sql — Create, GetByToken, MarkUsed
  - [ ] internal/store/queries/invites.sql — Create, GetByToken, MarkAccepted, ListByCenter
- [ ] Task 4: Run sqlc generate (AC: #5)
- [ ] Task 5: Create test helpers (AC: #6)
  - [ ] internal/test/helpers.go — SetupDB, TenantContext
  - [ ] internal/test/fixtures.go — CreateUser, CreateCenter, CreateCenterMember
- [ ] Task 6: Write adversarial test suite (AC: #4)
  - [ ] internal/test/adversarial_test.go
  - [ ] Test cross-tenant read: tenant A cannot see tenant B data
  - [ ] Test cross-tenant write: tenant A cannot UPDATE tenant B data
  - [ ] Test null tenant: zero rows returned
  - [ ] Test unset tenant: zero rows returned
  - [ ] Test RLS on INSERT, UPDATE, DELETE (not just SELECT)
  - [ ] Use deterministic tenant IDs (00000000-...-000000000001, ...-000000000002)

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
