# Story 7-1a: Completion Notes

_Implementation record for [`7-1a-staff-management-and-invitation-backend.md`](./7-1a-staff-management-and-invitation-backend.md). Status: review._

## Dev Agent Record

### Debug Log

- **`ListStaffMembers.LastActiveAt` came out `interface{}`.** sqlc could not infer the type of `max(rt.created_at)` through the LATERAL alias. Fixed by casting `max(rt.created_at)::timestamptz` → `pgtype.Timestamptz`, which is what the AC8 reds read (`.Valid`/`.Time`).
- **`archived_at` rippled the `CenterMember` model.** Adding `center_members.archived_at` made sqlc emit a per-query `CreateCenterMemberRow` (the `RETURNING user_id, center_id, role, created_at` no longer matched the now-5-column model), breaking `test/fixtures.go` which returns `generated.CenterMember`. Fixed by extending `CreateCenterMember`'s `RETURNING` to include `archived_at` so it maps back to the full model — zero test churn.
- **`AdminInviteStaff` signature change broke shipped 2.6 callers.** Widening to `AdminInviteStaffInput` broke 5 existing test files (`auth_role_negative_test.go`, `auth_admin_hierarchy_test.go`, `invites_rls_test.go`, `role_revalidation_atdd_test.go`). Updated every caller to `service.AdminInviteStaffInput{Email, Role}` (additive fields nil) — behavior unchanged.
- **Red seed-ordering bug (`CrossTenantClassId_CleanSkip`).** The red seeded the center-A invite while the GUC was still set to center B → `invites` RLS-insert violation (42501). Added a `test.TenantContext(t, db, centerA.ID)` before the seed (assertion untouched — B's class still proven unchanged).
- **Full-suite `-race` deadlocks are cross-package DB contention, NOT logic.** `go test ./... -race` (parallel package binaries) intermittently deadlocks in *test setup* (`create center TenantAID` / `pg_advisory_xact_lock`) for pre-existing tests (`TestLogoutHandler_AC05`, `TestRefresh_AC02`) — the repo's deterministic-tenant-ID convention (TEST-BE-1) can't tolerate concurrent package binaries on one DB. **`go test ./... -race -count=1 -p 1` is fully green.** The new staff tests (also using `TenantAID`/`TenantBID` per convention) increase the collision surface but are individually correct.

### Completion Notes

Shipped the full 7-1a backend slice — all 28 ACs, all ★ risk-driver reds green:

- **Migrations (Task 2):** `center_members.archived_at`, `invites.class_id` FK (`ON DELETE SET NULL`), and a `DROP+CREATE` of `get_invite_by_token_hash` to return `class_id` (D13a — the accept path cannot read the column otherwise). All three down/up round-trip verified.
- **Store (Task 3):** `queries/staff.sql` — `ListStaffMembers` (LATERAL aggregates, bound-`@now` half-open load window, `MAX(refresh_tokens.created_at)` last-active, derived status, owners excluded), `GetStaffMember`, `ListPendingStaffInvites`, `ArchiveCenterMember` (`:execrows`), `CountClassesByTeacher`; plus `ListAuditLogsByUser` in `audit_logs.sql`.
- **Invite widening (Task 5):** `AdminInviteStaffInput` — real email delivery (raw token no longer discarded; acceptURL `?token=<raw>`), `name`/`class_id` persistence, D7 classId-requires-teacher (422) + in-tenant class re-validation (404 `CLASS_NOT_FOUND`), D12 expired-supersede (refresh in place vs 409), `stripCRLFAndControls(centerName)` + HTML-escaped welcomeNote (D17b), best-effort enqueue (AC22).
- **Auto-assign-on-accept (Task 6):** widened `loadInviteByTokenHash` to carry `class_id`; `autoAssignTeacherClass` threaded into BOTH `acceptInviteAddMembership` (existing-user + OAuth) AND `acceptInviteCreateUserAndMember` (new-user), same tx, in-tenant `GetClassByID` re-validation → clean skip on a cross-tenant/stale class (never a cross-tenant `UpdateClass`), mutex-honored `UpdateClass`.
- **StaffService (Tasks 4 + 7):** reads (`ListStaff`, `GetStaffMemberDetail`) + Owner-only actions (`ArchiveStaff`, `AssignClass`, `ResetStaffPassword`) with SEC-1 DB role re-fetch, member/class guards → `model.NotFoundError`, `CANNOT_ARCHIVE_SELF`/`STAFF_ALREADY_ARCHIVED` conflicts, D17c `assignedClassCount` ghost, staff audits → `audit_logs` via `AuditService` (D15), Owner-reset via reset **primitives** with NO verified-gate/silent/padToFloor (D14).
- **StaffHandler + routes:** 5 routes on the production `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole(...) → rateLimit → ErrorMapper` chains (reads owner+admin, actions owner). Force-logout NOT re-mounted (D8 reuse; Task 8 = doc-note).

**Deviations / provisional (D10) flagged for 7-1b + `/bmad-tea`:**

1. **`recentActivity` keying.** `ListAuditLogsByUser` keys on `(center_id, user_id)` per Task 3's literal text — so it surfaces actions the member *performed*, not actions *taken on them* (staff-action audits have `user_id = actor`). D15's "feeds the detail view" intent (showing archive/reset/assign on the target) would want `entity_id` keying. Not red-covered; left per Task 3 to avoid misattributing the actor. 7-1b/bmad-tea to co-finalize the semantics.
2. **Staff-invite accept URL is query-style (`?token=<raw>`)** vs class-spawn's path-style (`/<raw>`). The token round-trip red pins `token=`. Both point at the same frontend accept page; 7-1b reconciles the format. Wired via `authSvc.SetInviteAcceptURLBase(cfg.AppInviteURLBase)`.
3. **`heavy` threshold `8` is a SQL literal** in `staff.sql` (the roster query computes the `Heavy` column directly; no threshold param since the red reads `Row.Heavy`). Documented to mirror the Go const `HeavyLoadThresholdSessionsPerWeek`; keep in sync.
4. **`NewStaffService`'s `AuthAuditLogger` param is intentionally unused** (`_`) — staff audits must land in `audit_logs` (AuditService), not `auth_audit_logs`. Kept for constructor uniformity with the auth-spine services and to match the ATDD seam signature.
5. **`GetStaffMemberDetail` composition** (assignedClasses/scheduleGlance/load/recentActivity) is built but only the 404-non-disclosure path is red-covered; the 200-composition shape is provisional (7-1b consumes + co-finalizes; `/bmad-tea` P2/P3 expands coverage).

### Implementation Plan (as executed)

1. Recon: read all 6 red files + reuse clusters (email/reset primitives, model/audit/AuthService, test helpers) via parallel Explore agents; read core-modify files directly.
2. Migrations → `migrate.sh` up + down/up round-trip verify.
3. `queries/staff.sql` + `ListAuditLogsByUser` → `sqlc generate`; fixed `LastActiveAt` cast + `CreateCenterMember` RETURNING ripple.
4. `api.yaml` (provisional staff shapes + widened `InviteStaffRequest`) → `openapi-typescript` validate.
5. `loadInviteByTokenHash` widen + `autoAssignTeacherClass` into both accept fns (Task 6).
6. `AdminInviteStaff` widen (Task 5) + invites handler request struct.
7. `staff_service.go` (reads + actions) + `staff_handler.go` + `main.go` routes.
8. `story_7_1a_helpers.go` test-server helper (marks caller verified; production chains).
9. Ran reds under `-tags=atdd_red_phase` → 1 seed fix → all 29 green → de-tagged → full suite `-race -p 1` green.
10. Canonical `codegen.sh`; `gofmt -w` new files; `tsc -b` = 0.

## File List

### Added

- `classlite-api/migrations/20260828120000_add_center_members_archived_at.{up,down}.sql` — D4 soft-archive column.
- `classlite-api/migrations/20260828120100_add_invites_class_id.{up,down}.sql` — D7 optional target class FK.
- `classlite-api/migrations/20260828120200_alter_get_invite_by_token_hash_class_id.{up,down}.sql` — D13a fn returns `class_id`.
- `classlite-api/internal/store/queries/staff.sql` — roster read model + archive + class-count.
- `classlite-api/internal/service/staff_service.go` — StaffService (reads + Owner actions).
- `classlite-api/internal/handler/staff_handler.go` — StaffHandler + provisional wire shapes.
- `classlite-api/internal/test/story_7_1a_helpers.go` — `NewStaffTestServerForRole`.
- ATDD reds (de-tagged, now permanent regression): `internal/test/staff_load_aggregate_atdd_test.go`, `internal/test/staff_roster_rls_atdd_test.go`, `internal/service/staff_invite_widening_atdd_test.go`, `internal/service/staff_accept_autoassign_atdd_test.go`, `internal/service/staff_service_atdd_test.go`, `internal/handler/staff_handler_atdd_test.go`.

### Modified

- `classlite-api/api.yaml` — widened `InviteStaffRequest`; added 5 staff endpoints + provisional schemas (`StaffMember`/`PendingInvite`/`StaffMemberDetail`/action results).
- `classlite-api/internal/service/auth_admin.go` — `AdminInviteStaffInput` + real email + D7/D12 + `appendInviteWelcomeNote`.
- `classlite-api/internal/service/auth_invite.go` — `class_id` threaded; `autoAssignTeacherClass` into both accept paths.
- `classlite-api/internal/service/auth_google.go` — `loadInviteByTokenHash` returns `class_id` (3 call sites updated).
- `classlite-api/internal/service/auth.go` — `inviteAcceptURL` field + `SetInviteAcceptURLBase`.
- `classlite-api/internal/handler/invites_handler.go` — widened request body; builds `AdminInviteStaffInput`.
- `classlite-api/internal/store/queries/center_members.sql` — `CreateCenterMember` RETURNING + `archived_at` (model-map fix).
- `classlite-api/internal/store/queries/audit_logs.sql` — `ListAuditLogsByUser`.
- `classlite-api/cmd/api/main.go` — StaffService/Handler wiring + 5 routes; `SetInviteAcceptURLBase`.
- `classlite-web/src/lib/api/client.ts` — regenerated (additive-only, +523/-0).
- Shipped 2.6/1.5 test callers updated to the widened `AdminInviteStaff` signature: `auth_admin_hierarchy_test.go`, `auth_role_negative_test.go`, `role_revalidation_atdd_test.go`, `invites_rls_test.go`.

### Deleted

- None.

## Verification

- `go build ./... && go vet ./...` — clean.
- `go test ./... -race -count=1 -p 1` — **all packages green** (parallel-package run has pre-existing cross-package DB-contention flakes; serialize with `-p 1`).
- 29 ATDD reds green + de-tagged; the ★ risk-driver reds proven: token round-trip, auto-assign×mutex×accept-time-cross-tenant (real DB, both accept paths), SEC-1 JWT-vs-DB service seam, cross-tenant row-unchanged, bound-`now` load boundary + fan-out.
- `scripts/codegen.sh` — canonical; `client.ts` additive-only (+523/-0).
- `classlite-web` `tsc -b` — 0 errors.
