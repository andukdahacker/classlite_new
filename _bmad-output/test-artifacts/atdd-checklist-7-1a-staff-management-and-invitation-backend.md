---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-08-28'
storyId: '7.1a'
storyKey: '7-1a-staff-management-and-invitation-backend'
storyFile: _bmad-output/implementation-artifacts/7-1a-staff-management-and-invitation-backend.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-7-1a-staff-management-and-invitation-backend.md
detectedStack: backend
generationMode: ai-generation
generatedTestFiles:
  - classlite-api/internal/test/staff_load_aggregate_atdd_test.go
  - classlite-api/internal/test/staff_roster_rls_atdd_test.go
  - classlite-api/internal/service/staff_invite_widening_atdd_test.go
  - classlite-api/internal/service/staff_accept_autoassign_atdd_test.go
  - classlite-api/internal/service/staff_service_atdd_test.go
  - classlite-api/internal/handler/staff_handler_atdd_test.go
inputDocuments:
  - _bmad-output/implementation-artifacts/7-1a-staff-management-and-invitation-backend.md
  - _bmad-output/project-context.md
  - docs/project-context.md
  - classlite-api/internal/test/auto_grade_results_rls_atdd_test.go (real-DB RLS red precedent, 6-4a)
  - classlite-api/internal/handler/accept_invite_handler_atdd_test.go (handler ErrorMapper red precedent, 1.6)
  - classlite-api/internal/test/story_2_6_helpers.go (invite test-server + SignAccessTokenForRole)
  - classlite-api/internal/service/auth_admin.go (AdminInviteStaff spine — D2 token-discard placeholder)
  - classlite-api/internal/service/auth_invite.go (both accept paths — D13 auto-assign target)
  - classlite-api/internal/service/auth_reset.go (RequestPasswordReset + primitives — D14)
  - classlite-api/internal/service/email_mock.go (MockEmailSender.Snapshot/Count/SendError)
knowledgeFragments:
  - test-levels-framework
  - test-priorities-matrix
  - test-quality
  - test-healing-patterns
  - data-factories
---

# ATDD Red-Phase Checklist — Story 7.1a (Staff Management & Invitation — Backend)

> **WF-8 HARD GATE (risk_score = 7).** These `//go:build atdd_red_phase` reds MUST be on the
> branch BEFORE the story transitions to `in-progress`. Convention: tagged-compile-fail
> (`reference_atdd_red_convention`), **not** `t.Skip`. Playwright E2E for the staff flows
> rides Story 7-1b. The ★ risk-driver reds are non-negotiable (party-mode Murat/Winston).

## 1. Preflight & Context

- **Stack:** backend (Go 1.25, `classlite-api/go.mod`). Auto-detected; `test_stack_type: auto`.
  Frontend exists but 7-1a is a pure Go backend slice — no browser tests in scope.
- **Framework:** stdlib `testing` + real DB via `test.SetupDB(t)` (tx-wrapped, auto-rollback,
  RLS enforced under `SET LOCAL ROLE classlite_app`). Deterministic tenants `TenantAID`/`TenantBID`.
  Fake clock via `clock.MockClock` (D16 bound-`now`). Email seam via `service.MockEmailSender`
  (`.Snapshot()`, `.Count()`, `.SendError`).
- **Red convention verified against shipped precedents:**
  - `internal/test/auto_grade_results_rls_atdd_test.go` — the real-DB RLS grid + **savepoint +
    re-read-as-B** row-unchanged control (6-4a, the freshest sibling keystone).
  - `internal/handler/accept_invite_handler_atdd_test.go` — the `middleware.ErrorMapper → handler`
    envelope pattern + `seedInviteForHandler` + `hashInviteTokenForHandlerTest`.
  - `internal/handler/force_logout_handler_atdd_test.go` — `newForceLogoutHarness` +
    `seedRefreshTokensFor` (AC16 reuse-regression basis).
  - `internal/test/story_2_6_helpers.go` — `SignAccessTokenForRole` (the SEC-1 JWT-vs-DB seam
    driver) + the invites RequireRole chain.
- **Mock seams honored (project-context Test Architecture):**
  - **store / real-DB in tx** — every RLS/mutex/aggregate/token-round-trip red (a mock store
    false-greens the `classes_teacher_mutex` CHECK — Murat, AC20 note).
  - **service = mock store** — ONLY the SEC-1 JWT-vs-DB grid (E16) + email-enqueue-failure (AC22).
  - **handler = real middleware chain** — the authz edge (`RequireRole`).
  - **email = `MockEmailSender`** — assert enqueued payload (token round-trip) AND assert empty
    (cross-tenant reset must send nothing).

## 2. Generation Mode

**AI generation** (backend → no browser recording; `tea_browser_automation` moot for Go).
Reds are authored **directly** as Go files rather than via the skill's generic `test.skip()`
JS subagents: the project's build-tag convention (`reference_atdd_red_convention`) OVERRIDES
the skill's default red form, and the reds must mirror byte-exact Go idioms a generic worker
would mangle — savepoint + re-read row-unchanged controls, `pgconn.PgError` `P0001`/`23505`
code asserts, `set_config('app.current_tenant_id', …, true)` tenant binds, `sqlc.arg`-bound
`now` boundary math.

## 3. Test Strategy — AC → level / priority / red

**Seam discipline (the load-bearing decision).** ★ = party-mode risk-driver red (the difference
between "reds prove the risk" and "reds prove the happy path"):

- **Real DB in tx (store/integration)** — every RLS, mutex, aggregate, and token-round-trip red.
  A mock store false-greens the `classes_teacher_mutex` CHECK and the FORCE-RLS grid (Murat, AC20).
- **Service-direct (real DB, no middleware)** — the SEC-1 JWT-vs-DB gate. A real-middleware test
  seeded DB=admin/JWT=owner is blocked at `RequireRole` at the EDGE and never reaches the
  service's DB re-fetch (the load-bearing gate). To exercise it we call the service with a
  hand-built `TenantContext{Role:"owner"}` over a DB member row that is `admin`.
- **Real middleware chain (handler)** — the authz edge grid + envelope shape + existence non-disclosure.
- **`MockEmailSender`** — assert the enqueued payload (token round-trip) AND assert empty
  (cross-tenant reset sends nothing).

### File 1 — `internal/test/staff_load_aggregate_atdd_test.go` (real DB, store query — D5/D6/D16)

| AC | Scenario | Level | Pri | Red test |
|----|----------|-------|-----|----------|
| 7/D16 | ★ bound-`now` half-open boundary: `starts_at==now` IN, `==now+7d` OUT | Store | P0 | `TestStaffLoad_BoundNowHalfOpenBoundary_ATDD` |
| 7 | `heavy` at 8 (true) vs 7 (false) — named constants | Store | P0 | `TestStaffLoad_HeavyThresholdAtEight_ATDD` |
| 7 | only `status='scheduled'` counts (cancelled/completed/in_progress excluded) | Store | P0 | `TestStaffLoad_ScheduledStatusOnly_ATDD` |
| 7 | admin (never a class teacher) → `sessionsPerWeek=0, heavy=false` | Store | P1 | `TestStaffLoad_AdminYieldsZero_ATDD` |
| 7/A1 | ★ fan-out: teacher with N classes × M sessions → true SUM AND appears exactly once | Store | P0 | `TestStaffLoad_FanOutSumAppearsOnce_ATDD` |
| 8/D6 | last-active = `MAX(refresh_tokens.created_at)`; no row → `null` | Store | P0 | `TestStaffLastActive_NullAndMax_ATDD` |
| 8 | cross-user isolation — two users each get their own MAX | Store | P0 | `TestStaffLastActive_CrossUserIsolation_ATDD` |

### File 2 — `internal/test/staff_roster_rls_atdd_test.go` (real DB, RLS + write isolation + segregation — F/A/AC28)

| AC | Scenario | Level | Pri | Red test |
|----|----------|-------|-----|----------|
| 17/F | cross-tenant READ: A's roster omits B's members; `GetStaffMember(Buser)` under A → no row | Store/RLS | P0 | `TestRLS_StaffRoster_CrossTenantRead_ATDD` |
| 17/F | ★ cross-tenant WRITE row-unchanged (savepoint + re-read-as-B): archive B → `archived_at` still NULL | Store/RLS | P0 | `TestRLS_StaffArchive_CrossTenant_NoMutation_ATDD` |
| 17/F | ★ cross-tenant WRITE row-unchanged: assign-class B → `classes.teacher_id` unchanged | Store/RLS | P0 | `TestRLS_StaffAssignClass_CrossTenant_NoMutation_ATDD` |
| 1/3/D3 | list segregation: archived member in `members` w/ `status=archived`; owner excluded; pending never in `members` | Store | P0 | `TestStaffRoster_SegregatesArchivedPendingExcludesOwner_ATDD` |
| 28 | ★ double-archive: `ArchiveCenterMember` `:execrows` → 1 then 0 (drives 409 `STAFF_ALREADY_ARCHIVED`) | Store | P0 | `TestStaffArchive_DoubleArchiveExecRowsZero_ATDD` |

_(D17c ghost `assignedClassCount` moved to File 5 — it rides the `ArchiveResult` service shape, not the store query.)_

### File 3 — `internal/test/staff_invite_autoassign_atdd_test.go` (real DB — D2/D7/D12/D13 crown jewel)

| AC | Scenario | Level | Pri | Red test |
|----|----------|-------|-----|----------|
| 9/D2 | ★ token round-trip: invite → pull `acceptURL` from `MockEmailSender` → hash == persisted `token_hash` → feed raw to `AcceptInvite` → membership created | Integration | P0 | `TestStaffInvite_TokenRoundTripToMembership_ATDD` |
| 22/D17b | welcomeNote HTML/link escaped in body; `centerName` through `stripCRLFAndControls` | Integration | P1 | `TestStaffInvite_WelcomeNoteEscaped_CenterNameStripped_ATDD` |
| 22 | email best-effort: injected send/enqueue failure ⇒ invite row committed, no service error | Integration | P0 | `TestStaffInvite_EmailFailure_InviteStillCommitted_ATDD` |
| 10/21 | dedup: non-expired dup → 409; ★ **D12 expired → SUPERSEDE** (refreshed row, new token, no 409); re-invite w/ different classId on non-expired → still 409 | Integration | P0 | `TestStaffInvite_ExpiredSupersedes_NonExpired409_ATDD` |
| 10/D7 | classId-requires-teacher (non-teacher+classId → 422); classId not in center → 404 `CLASS_NOT_FOUND`; FR-11 admin-invites-owner → 403 | Integration | P0 | `TestStaffInvite_ClassIdGuardsAndFR11_ATDD` |
| 11/23 | ★ auto-assign: teacher+classId → `teacher_id` set, `pending_teacher_email` nulled atomically (mutex-honored) | Integration | P0 | `TestStaffAccept_AutoAssign_SetsTeacherClearsPending_ATDD` |
| 11/23 | ★ accept whose class has `pending_teacher_email` set → SUCCEEDS (exactly one column set, acceptance NOT rolled back) | Integration | P0 | `TestStaffAccept_AutoAssign_MutexCollisionStillCommits_ATDD` |
| 11/23 | reassign displaces prior teacher X cleanly | Integration | P1 | `TestStaffAccept_AutoAssign_ReassignsDisplacingPrior_ATDD` |
| 11/23 | non-teacher / no-classId → class assignment untouched (no-op) | Integration | P1 | `TestStaffAccept_AutoAssign_NoOpWhenNoClassOrNonTeacher_ATDD` |
| 23/D13c | ★ accept-time classId → class no longer in-tenant → clean skip, NEVER a cross-tenant `UpdateClass` | Integration | P0 | `TestStaffAccept_AutoAssign_CrossTenantClassId_CleanSkip_ATDD` |
| 23/D13b | ★ auto-assign fires on the **OAuth** accept path too (new-user path is covered by `SetsTeacherClearsPending`) | Integration | P0 | `TestStaffAccept_AutoAssign_FiresOnOAuthPath_ATDD` |

### File 4 — `internal/handler/staff_handler_atdd_test.go` (real middleware chain — A/B/E authz edge)

| AC | Scenario | Level | Pri | Red test |
|----|----------|-------|-----|----------|
| 1 | owner `GET /api/staff` → 200 envelope `{ data: { members, pendingInvites } }` (top-level shape only, D10 provisional) | Handler | P0 | `TestStaffHandler_ListHappy200Envelope_ATDD` |
| 2/6 | teacher + student → 403 `INSUFFICIENT_ROLE` on `GET /api/staff` AND `GET /api/staff/{id}` | Handler | P0 | `TestStaffHandler_ReadAuthzGrid_TeacherStudent403_ATDD` |
| 16 | admin / teacher / student → 403 on archive / assign-class / reset (edge `RequireRole("owner")`) | Handler | P0 | `TestStaffHandler_ActionAuthzGrid_NonOwner403_ATDD` |
| 5/B5 | admin → `GET /api/staff/{ownerUserId}` → 404 `STAFF_NOT_FOUND` (owner not disclosed) | Handler | P0 | `TestStaffHandler_OwnerDetailNonDisclosure404_ATDD` |
| 14 | self-archive → 409 `CANNOT_ARCHIVE_SELF` | Handler | P1 | `TestStaffHandler_SelfArchive409_ATDD` |

**AC16 force-logout REUSE (FR-80) — NOT re-tested (already shipped).** The teacher-target
happy path + cross-tenant-404 are already covered by `TestForceLogout_AC06_HappyPath_200Envelope`
and `TestForceLogout_AC07_CrossTenant_Returns404_NotForbidden` (Story 1.6). Task 8 is a
doc-note + 7-1b button wiring — writing a third copy would violate the no-duplicate-coverage rule.

### File 5 — `internal/service/staff_service_atdd_test.go` (service-direct real DB — SEC-1 ★ + D14 + D15 + D17c + AC17 reset)

| AC | Scenario | Level | Pri | Red test |
|----|----------|-------|-----|----------|
| 16/E16 | ★ **SEC-1 JWT-vs-DB**: `tc.Role="owner"` (stale) but DB member `admin` → archive/assign/reset → 403 (DB wins) | Service | P0 | `TestStaffService_SEC1_JWTOwnerDBAdmin_403_ATDD` |
| 15/24/D14 | ★ reset on an **UNVERIFIED** member → `password_resets` row created + email enqueued (NO verified-gate / silent / padToFloor) | Service | P0 | `TestStaffService_ResetUnverifiedMember_CreatesRowAndEmail_ATDD` |
| 17 | ★ cross-tenant reset sends NOTHING: B-targeted reset under A → 404 + `MockEmailSender` empty | Service | P0 | `TestStaffService_CrossTenantReset_NoEmail_ATDD` |
| 25/D15 | staff action audit lands in `audit_logs` (entityType `center_member`), NOT `auth_audit_logs` | Service | P0 | `TestStaffService_AuditWritesAuditLogsNotAuthAudit_ATDD` |
| 28/D17c | archive of a teacher w/ N classes → `ArchiveResult.assignedClassCount=N`, classes NOT auto-unassigned | Service | P1 | `TestStaffService_ArchiveAssignedClassCountGhost_ATDD` |
| 13/14/15 | member/class guards: assign non-teacher → 404 `STAFF_NOT_FOUND`; class not in center → 404 `CLASS_NOT_FOUND`; reset non-member → 404 | Service | P1 | `TestStaffService_ActionMemberClassGuards_404_ATDD` |

**AC20 minimum red set — coverage map.** ★ token round-trip (F3) ✅ · ★ auto-assign × mutex ×
accept-time-cross-tenant triple, real DB, both accept paths (F3) ✅ · ★ SEC-1 JWT-vs-DB
service-seam (F5) ✅ · ★ cross-tenant row-unchanged, re-read control (F2) ✅ · ★ bound-`now`
load boundary + fan-out (F1) ✅ · D12 expired-supersede (F3) ✅ · email-best-effort-2xx (F3) ✅ ·
existence non-disclosure (F4) ✅ · double-archive 409 + ghost `assignedClassCount` (F2) ✅ ·
D14 unverified-reset bypass + cross-tenant-reset-empty (F5) ✅ · D15 audit target (F5) ✅ ·
last-active null/max/cross-user (F1) ✅ · force-logout reuse regression (F4) ✅.

**Confidence-gate calls (do NOT fabricate).** (a) The two load constants
(`DefaultWeeklySessionCapacity=10`, `HeavyLoadThresholdSessionsPerWeek=8`) are the story's
frozen defaults — reds assert `heavy` flips at 8, the exact boundary the story pins; dev may
retune during red-phase, then they freeze. (b) Provisional wire field names (D10) are asserted
**loosely** at the handler envelope (top-level `data.members`/`data.pendingInvites` presence) —
NOT their inner field spellings, which 7-1b co-finalizes. (c) Store-query integer outputs
(load counts, `:execrows`) ARE asserted exactly — they are the query contract, not the wire shape.

## 4. Green-phase SEAMS (the reconcile map — one place per seam)

Everything the reds compile-fail on. Turn each green in the dev order below (WF-1: api.yaml →
codegen; WF-3: migration → sqlc gen).

**Migrations (Task 2):**
- `center_members.archived_at timestamptz NULL` (D4) — status derivation + `ArchiveCenterMember`.
- `invites.class_id uuid NULL FK → classes(id)` (D7) — invite-time persist + accept-time auto-assign.
- `CREATE OR REPLACE get_invite_by_token_hash` to add `class_id` to its `RETURNS TABLE` (D13a) —
  without it the accept path cannot see `class_id`; widen `loadInviteByTokenHash`'s SELECT+scan
  (`auth_google.go:729`) to carry it.

**Store — `queries/staff.sql` + regen (Task 3):**
- `ListStaffMembers(ListStaffMembersParams{CenterID pgtype.UUID, Now pgtype.Timestamptz}) → []ListStaffMembersRow`
  Row: `UserID · Role · Status ('active'|'archived') · NextSevenDaysSessionCount int64 · Heavy bool · LastActiveAt pgtype.Timestamptz` — role IN ('admin','teacher'), owners EXCLUDED (D3/D11), load window `[@now, @now+7d)` HALF-OPEN with the BOUND `@now` arg (D16), `lastActiveAt=MAX(refresh_tokens.created_at)` (D6).
- `GetStaffMember(GetStaffMemberParams{CenterID, UserID})` → row / `pgx.ErrNoRows` (drives 404, excludes student/owner).
- `ArchiveCenterMember(ArchiveCenterMemberParams{CenterID, UserID}) → int64` (`:execrows`, SET archived_at WHERE archived_at IS NULL).
- (D9, not red-covered here but same task) `ListAuditLogsByUser` for the detail `recentActivity`.

**Service (Task 5/6/7):**
- `AdminInviteStaffInput{ Email, Role string; Name, WelcomeNote *string; ClassID *uuid.UUID }` +
  widened `AdminInviteStaff(ctx, tc, AdminInviteStaffInput) (*InviteResult, error)` — real email
  (stop discarding the raw token), acceptURL carries `?token=<raw>`, `stripCRLFAndControls(centerName)`,
  welcomeNote HTML-escaped, best-effort enqueue, D12 expired-supersede, classId guards.
- Auto-assign threaded into BOTH `acceptInviteAddMembership` AND `acceptInviteCreateUserAndMember`,
  same tx, in-tenant `GetClass` re-validation, mutex-honored `UpdateClass` (D13).
- `StaffService` + `NewStaffService(db, audit, retry, clk)`; `ArchiveStaff → (*ArchiveResult{AssignedClassCount int}, error)`,
  `AssignClass`, `ResetStaffPassword` — SEC-1 DB role re-fetch, guards → `model.NotFoundError`,
  audits via `InsertAuditLog`→`audit_logs` (D15), reset via primitives (NO verified/silent/padToFloor, D14).

**Handler test-server (Task 9):**
- `test.NewStaffTestServerForRole(t, db, callerUserID pgtype.UUID, centerID, role string) http.Handler` —
  mirror `NewInvites2_6TestServerForRole`; mount the staff routes on the production Require* chain.

## 5. Validation

- **Untagged `go build ./...` + `go vet ./internal/{test,service,handler}/` → GREEN.** The reds are
  build-tag-quarantined; the main suite is unaffected (WF-8 on-branch-but-quarantined).
- **Tagged compile (`-tags=atdd_red_phase -gcflags=all=-e`) fails on the GREENFIELD seams ONLY** —
  verified by filtering every `*.go:line:col:` error against the seam list: `(none — every compile
  error is an intended greenfield seam)`. No accidental typos in shipped helpers.
- **Seam collisions fixed:** my `mustPgUUID`/`seedOwnerCenter` clashed with `settings_test.go` →
  renamed to `staffPgUUID`/`seedStaffOwnerCenter` (package `service_test` is one namespace).
- **Confidence-gate honored:** load constants asserted only at the frozen boundary (heavy@8);
  provisional wire field spellings asserted loosely at the handler (top-level keys); store-query
  integers asserted exactly. No fabricated response shapes hardened into a red.
- **Schema-truth flagged to dev:** `sessions.status` CHECK is 2-valued (`scheduled`,`cancelled`);
  the AC7 prose "completed/in_progress excluded" has no column basis — the scheduled-only red
  asserts scheduled-IN / cancelled-OUT.

### Generated red files (13 store/integration + 11 service + 5 handler = 29 reds)

| File | Package | Reds | Seam |
|---|---|---|---|
| `internal/test/staff_load_aggregate_atdd_test.go` | test | 7 | `generated.ListStaffMembers*` |
| `internal/test/staff_roster_rls_atdd_test.go` | test | 5 | `generated.ListStaffMembers/GetStaffMember/ArchiveCenterMember` |
| `internal/service/staff_invite_widening_atdd_test.go` | service_test | 5 | `service.AdminInviteStaffInput` |
| `internal/service/staff_accept_autoassign_atdd_test.go` | service_test | 6 | (auto-assign behavior; shares the invite seam's tag) |
| `internal/service/staff_service_atdd_test.go` | service_test | 6 | `service.StaffService` |
| `internal/handler/staff_handler_atdd_test.go` | handler_test | 5 | `test.NewStaffTestServerForRole` |

## Run command (the red gate)

```bash
cd classlite-api
# Untagged suite unaffected:
go build ./... && go vet ./internal/test/ ./internal/service/ ./internal/handler/
# The RED gate (expect COMPILE FAILURE on the greenfield seams above):
go test -tags=atdd_red_phase -run='Staff|StaffService|RLS_Staff|ForceLogout' ./internal/test/ ./internal/service/ ./internal/handler/
# After green: de-tag and run under -race -count=1 as permanent regression.
```

## Handoff → BMM dev-story

Dev order (WF-1/WF-3): **migrations** (archived_at · invites.class_id · `CREATE OR REPLACE get_invite_by_token_hash`)
→ **sqlc gen** (`queries/staff.sql`, `ListAuditLogsByUser`) → **api.yaml** (provisional read/action shapes, D10)
→ **codegen.sh** → **invite widening + real email** (Task 5) → **auto-assign on all 3 accept paths** (Task 6)
→ **StaffService read + actions** (Task 7) → **staff test-server helper** (Task 9) → turn reds green + de-tag.

No `t.Parallel()` on the DB-tx reds. `MockEmailSender` asserts enqueued (round-trip) AND empty
(cross-tenant reset). Then `/bmad-tea TA` (P2/P3 expansion — detail composition, `recentActivity`,
`scheduleGlance`, envelope field-shape once 7-1b co-finalizes D10) + `/bmad-tea RV` (flake/quality)
per WF-8. Playwright E2E rides 7-1b.
