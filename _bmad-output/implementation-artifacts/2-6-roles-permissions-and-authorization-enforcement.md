---
baseline_commit: 4736512
---

# Story 2.6: Roles, Permissions & Authorization Enforcement

Status: done

<!-- Closes Epic 2 (retrospective is the only remaining item). Wires the FIRST end-to-end role-aware surface: frontend `useRole()` graduates from the Story 1-7c null-stub to real auth-driven resolution, then per-route `<RouteRoleGate>` replaces the inline role gates shipped by 2-5a/b/c. Ships FR-9 (role ladder) and FR-11 (only Owner can promote Owner). Absorbs three deferred items: CR-2-5A-7 (role-null flash), PermissionDenied `sectionName?` prop, and FU-2-1-B (`center_members.role` CHECK constraint). -->
<!-- **FR-10 (two configurable capabilities per role) DEFERRED to FU-2-6-E** per party-mode review 2026-07-17 — the two toggles (`can_see_teacher_analytics`, `can_publish_knowledge_hub`) ship without consumers (Epic 4/8 own the read surfaces). Shipping dead switches violates CQ-1 and adds ~40% surface for zero user value until Epic 4 or Epic 8 lands. Epic 2.6 AC3 (permissions matrix) also defers with FU-2-6-E — Epic 2 retrospective will note the deferral. -->
<!-- Backend surface: 1 CHECK-constraint migration on `center_members.role` + `invites.role` (closes FU-2-1-B) + 1 new endpoint (`POST /api/centers/{id}/invites` for FR-11) + extended `AdminInviteStaff` service allowing Admin callers to invite Teacher/Admin but rejecting Owner (FR-11). Frontend surface: real `useRole()` + `useRoleLoading()` hooks + role gate on `/settings` (removes 2-5a inline gate) + `<RouteRoleGate>` route helper with `loadingFallback` prop + `PermissionDenied` `sectionNameKey` discriminated union. NO permissions matrix screen; NO `center_permissions` table; NO frontend invite form (Epic 7). -->
<!-- Load-bearing risk: R15 (JWT role-claim staleness, score 6) — DISCHARGED inline via Task 5.3 extending the shipped `service/auth_admin.go` SEC-1 ceremony. ATDD Task 0 SKIPPABLE per Story 2-5c precedent. -->

## Story

As a **center Owner**,
I want **the sidebar, screens and API to obey a fixed role ladder (Owner > Admin > Teacher; Student separate) where only I can promote another Owner and Admins can help invite staff below their own level**,
so that **Admins can help run the center without being able to lock me out, and every API call is authorized on the server, not just by hiding UI**.

## Response Envelope Contract

Inherits shipped envelopes. New error codes registered in `internal/handler/errors.go`:

| Code | HTTP | When |
|---|---|---|
| `INSUFFICIENT_ROLE` | 403 | Existing (from `RequireRole`); reused unchanged. |
| `ROLE_ASSIGNMENT_FORBIDDEN` | 403 | Admin caller attempts to invite/promote a user with role=`owner` (FR-11). Message: `"Only an Owner can assign the Owner role."` |
| `INVITE_EMAIL_TAKEN` | 409 | Invite email already has an active (unexpired, non-consumed) invite row on this center. Message: `"An active invite already exists for this email."` + `details: { field: "email" }`. |

## Acceptance Criteria

1. **Role hierarchy is materialized in DB + code**. New migration `{YYYYMMDDHHMMSS}_add_role_check_center_members` adds `CHECK (role IN ('owner', 'admin', 'teacher', 'student'))` to `center_members.role` **AND** to `invites.role`. `.down.sql` uses `ALTER TABLE ... DROP CONSTRAINT IF EXISTS`. Closes **FU-2-1-B**.

   **Pre-flight assertion is a gate, not a comment** [Winston-STRONG-2 amendment]. `.up.sql` wraps each ALTER in an explicit assertion block that RAISEs on rogue rows so a deploy-time surprise fails loudly at migrate time, not at the constraint violation:
   ```sql
   DO $$ BEGIN
       IF EXISTS (SELECT 1 FROM center_members WHERE role NOT IN ('owner','admin','teacher','student')) THEN
           RAISE EXCEPTION 'center_members contains non-canonical role values; abort constraint add';
       END IF;
   END $$;
   ALTER TABLE center_members ADD CONSTRAINT center_members_role_check CHECK (role IN ('owner','admin','teacher','student'));
   -- Same shape for invites.role.
   ```

   New shared package `internal/model/roles.go` exports:
   - `Role` (string alias) + `RoleOwner` / `RoleAdmin` / `RoleTeacher` / `RoleStudent` constants.
   - `IsValidRole(r string) bool`.
   - `OutranksOwner(inviter, target string) bool` — **rejection predicate** returning true iff `target == "owner" AND inviter != "owner"`. Godoc explicitly states polarity: *"Returns true iff the target-role promotion should be BLOCKED — i.e., an Owner-target requires an Owner-caller."* Callsite reads `if roles.OutranksOwner(caller.Role, req.Role) { return &RoleAssignmentForbiddenError{} }`.

2. **Frontend Session cache carries `role`**. `Session` interface at `classlite-web/src/features/auth/api/authKeys.ts:65-69` gains `role: Role | null` (null only for boot-probe before login lands). Every session writer sets it explicitly:
   - `useLogin.onSuccess` → `role = response.role`.
   - `useRegister.onSuccess` → `role = null` (register mints token WITHOUT center; role claim is empty).
   - `useAcceptInvite.onSuccess` → `role = response.role`.
   - `useCreateCenter.onSuccess` → `role = 'owner'` (center creation always mints caller as Owner per Story 2-1 AC2).
   - Silent refresh (`auth-refresh.ts:63-66` + `:75-86`) — `RefreshSessionData.role` + `SessionCacheEntry.role` fields added; backend `/api/auth/refresh` response body extended with `role` (parallel to shipped login/create-center); pre-existing sessions rehydrate `role = null` and `useRoleLoading()` gate (AC3) covers the gap until refresh resolves.
   - Storybook seeders in `PersonaSelectPage.stories.tsx` / `CenterSetupPage.stories.tsx` / `OnboardingDonePage.stories.tsx` and every other `queryClient.setQueryData(authKeys.session(), ...)` site populate `role` explicitly.

3. **`useRole()` returns the real role**. Replace the `RoleContext` stub-return with `session?.role ?? null` (Storybook / test override via `RoleProvider` still wins over session). New `useRoleLoading()` hook in `classlite-web/src/hooks/useRole.ts` returns `useAuth().isLoading || (session != null && session.role == null && session.center != null)` — CR-2-5A-7 fold: first clause handles boot-probe; second clause handles "session hydrated but role hasn't landed yet" during the refresh migration window.

   Test contract: `useRole.test.tsx` gets a (session-role × context-role) matrix — 4 tests. `useRoleLoading` gets its OWN test file [Murat-STRONG-3 amendment] `useRoleLoading.test.tsx` with 4 explicit cases:
   1. `isLoading=true, session=null` → returns `true` (boot-probe active).
   2. `isLoading=false, session.role='owner', session.center!=null` → returns `false` (real session).
   3. `isLoading=false, session.role=null, session.center=null` → returns `false` (unauthenticated).
   4. `isLoading=false, session.role=null, session.center!=null` → returns `true` (**deploy-window belt** — pre-2-6 session hydrated without role).

4. **`PermissionDenied` — `sectionNameKey` discriminated union** [Sally-BLOCKER-2 amendment]. Prop replaces the raw `sectionName?: string` design to eliminate the VN-grammar interpolation bug (UX-2: never concatenate translated strings with raw values).

   ```ts
   export type SectionNameKey = 'settings' | 'permissions' | 'billing'
   export interface PermissionDeniedProps {
     requiredRoles: PermissionDeniedRoles
     sectionNameKey?: SectionNameKey
   }
   ```

   When `sectionNameKey` is set, PermissionDenied looks up `t('app.permissionDenied.section.' + sectionNameKey + '.header')` and renders a sub-header under the title. Each section gets a **native-grammar** VN + EN string, not a template with an interpolated raw label. New i18n keys per locale — 3 sections × 1 header each = 6 keys total; 'permissions' + 'billing' preloaded for Epic 4/8 + Epic 9 consumers respectively (dead-copy is acceptable here — the keys are trivial and the alternative is per-consumer-story i18n additions which fragment the copy voice).

   Closes `[deferred-work.md:196]`. Rewrites the original AC4 sketch (`sectionName?: string`) to the discriminated-union pattern surfaced in party-mode review.

5. **`<RouteRoleGate>` — route-level element wrapper** [Sally-BLOCKER-1 + Winston-STRONG-3 amendments]. New file `classlite-web/src/components/shared/RouteRoleGate.tsx`. Renders `<Outlet />` when `role ∈ allowedRoles`; renders `<PermissionDenied requiredRoles={requiredRolesForCopy} sectionNameKey={sectionNameKey} />` on deny.

   **Loading fallback is a coherent component, not a bare div** [Sally-BLOCKER-1]. Ships with a `loadingFallback?: ReactNode` prop, defaulting to a new shared `<RouteAccessCheckingCard>` component with i18n copy `app.routeGate.checkingAccess` — a centered card with a spinner + "Checking access…" label (native VN + EN) rendered inside AppLayout's main area. This closes the CR-2-5A-7 fold at the UX layer (UX-1 loading trilogy) rather than just the code layer.

   ```ts
   export interface RouteRoleGateProps {
     allowedRoles: readonly Role[]
     requiredRolesForCopy: PermissionDeniedRoles
     sectionNameKey?: SectionNameKey
     loadingFallback?: ReactNode
   }
   ```

   Wired as a **plain `element:` wrapper** in React Router v7, NOT `errorElement:` — `errorElement` fires on thrown loader/render errors, not policy deny. Shipped TODO comments at `SettingsPage.tsx:25`, `PermissionDenied.tsx:17`, `routes.tsx:293-294` that reference "errorElement" are corrected inline as part of Task 7.3.

   `RouteRoleGate.test.tsx` covers 5 cases: (a) allowed role → Outlet renders; (b) denied role → PermissionDenied with correct sectionNameKey; (c) `useRoleLoading()` true → loading fallback renders (default card); (d) custom `loadingFallback` prop honored; (e) **boot-probe (session=null, role=null) renders loading fallback, NOT PermissionDenied** [Winston-STRONG-3].

6. **`/settings` moves to route-level gate**. `SettingsPage.tsx` inline block (`useRole` import + `if (role !== 'owner')` branch at lines 23-25 + 50 + 132-138) is DELETED. Route entry in `routes.tsx` wraps `/settings` in `<RouteRoleGate allowedRoles={['owner']} requiredRolesForCopy={['owner']} sectionNameKey="settings" />`. Closes the `[SettingsPage.tsx:25]` TODO. `SettingsPage.test.tsx` "Teacher role → PermissionDenied inside AppLayout" test moves to a new `routes/__tests__/settings-role-gate.test.tsx` rendered via a `renderRouteWithRole()` helper — same contract, different render tree.

7. **Sidebar filtering is real, not stubbed**. `AppLayout.tsx` already reads `useRole()` and passes to `SidebarShell`; `SIDEBAR_NAV_BY_ROLE` at `sidebarNavConfig.tsx:105-110` already contains the four per-role lists. **This story only requires the `useRole()` fix from AC3 to make the shipped wiring live for real users**.

   Regression coverage: new `AppLayout.role-filtering.test.tsx` renders `<AppLayout>` under each of four roles with a **seeded `Session.role`** (not `RoleProvider` override — the test MUST exercise the full session→useRole→sidebarNavConfig chain per Murat-INFO-2) and asserts:
   - Correct nav group set visible per role.
   - Wrong-role testids `queryByTestId(...)===null` per TEST-FE-6 (absent, not hidden).
   - Guest shell renders when `role===null`.

8. **Backend `POST /api/centers/{id}/invites` — FR-11 enforcement in service layer** (Epic 2.6 AC4).

   | Method | Path | Auth chain | Purpose |
   |---|---|---|---|
   | POST | `/api/centers/{id}/invites` | `ExtractTenant → RequireVerifiedEmail → RequireCenterContext → RequireRole("owner","admin") → settingsRateLimit → handler` | Body: `{ email: string, role: 'admin' \| 'teacher' \| 'owner' }`. **Service layer**: (a) SEC-1 re-fetches caller's DB role; (b) `roles.OutranksOwner(caller.DBRole, req.role)` from AC1 → 403 `ROLE_ASSIGNMENT_FORBIDDEN`; (c) duplicate-active-invite check → 409 `INVITE_EMAIL_TAKEN`; (d) insert `invites` row (extends the shipped `service/auth_admin.go:37-120` shape); (e) audit `center.invite.sent`. **Real email delivery deferred to Epic 7** (`FU-2-6-A`). No frontend consumer in this story — the People/Invites UI belongs to Epic 7. |

   Both layers must be present — middleware `RequireRole("owner","admin")` is fail-fast; service `OutranksOwner` is the load-bearing FR-11 gate (an Admin passes middleware but must still be rejected on Owner-target). Test coverage per AC9.

9. **Role-hierarchy test matrix — split explicitly across service + handler layers** [Murat-BLOCKER-2 + STRONG-1 amendments].

   **Service layer** (`internal/service/auth_admin_test.go`, mocked store per TEST-BE-4) — **6 rows**:
   1. Owner invites Teacher → success + invite row + audit.
   2. Owner invites Owner → success + invite row (FR-11 permits Owner-to-Owner promotion).
   3. Admin invites Teacher → success + invite row + audit.
   4. Admin invites Admin → success + invite row + audit.
   5. Admin invites Owner → `RoleAssignmentForbiddenError`, no invite row, audit-BLOCKED row per `auth_audit.go:41` pattern.
   6. **SEC-1 defense**: caller's JWT says `role="owner"` but DB says `role="teacher"` (post-demotion, within 15-min JWT window per EDGE-2) → `ForbiddenError` + `auth.role_revalidation_blocked` audit event. **Write this row FIRST (red), then green the service change** per Murat-INFO-1 — de-facto ATDD without paperwork.

   **Handler layer** (`internal/handler/invites_handler_atdd_test.go`, real middleware per TEST-BE-3) — **7 rows**:
   1-5. Same hierarchy shape, asserted at HTTP boundary (full envelope + status code + audit assertion via reading audit table).
   6. **Teacher caller middleware-blocked** [Murat-BLOCKER-2] — a Teacher's JWT hits the endpoint → `RequireRole("owner","admin")` returns 403 `INSUFFICIENT_ROLE`; service is NEVER invoked (no audit-BLOCKED row from the service; the middleware pre-empts). Belt-vs-suspenders assertion for the fail-fast HTTP gate.
   7. **Admin-invites-Owner end-to-end envelope** — middleware passes (Admin is in allowlist), service `OutranksOwner` rejects, HTTP boundary returns 403 `ROLE_ASSIGNMENT_FORBIDDEN` with correct envelope shape + `requestId`. Proves FR-11 defense-in-depth end-to-end.

   Handler test also asserts one **row-persistence positive assertion** [Murat open Q]: after Owner-invites-Teacher 201, read the `invites` table and verify `(center_id, email, role, expires_at)` shape. Store-shape assertions for other combos live in the store-layer test (real DB per TEST-BE-2, added inline in Task 5.2).

10. **i18n — pinned `STORY_2_6_KEYS` closed literal** [Sally-STRONG-2 amendment]. Append `describe('Story 2-6 i18n parity (R38)', () => { ... })` to `i18n-parity-coverage.test.ts`. Est **~15-25 keys** (revised down from original 30-40 with FR-10 permissions matrix deferred):
   - `app.permissionDenied.section.{settings,permissions,billing}.header` — 3 keys per locale (permissions + billing preloaded for Epic 4/8 + Epic 9).
   - `app.routeGate.checkingAccess` — 1 key per locale (Sally-B1 loading card).
   - `people.invite.error.roleAssignmentForbidden` — 1 key (403 error copy in future frontend).
   - `people.invite.error.emailTaken` — 1 key.
   - Backend error-mapper i18n for the 2 new codes (if the error-mapper already ships English literals per the shipped 2-5c pattern — decide at pickup whether to lift to i18n now or defer to CR-2-5B-3).
   - Any nav-strip labels needing scoping for role-aware rendering (verify at pickup — likely 0-4 keys).

   Total: **~15-25 keys × 2 locales = 30-50 assertions**. `noTrialMechanic` pre-flight — no `trial`/`dùng thử` in new copy. `assertI18nInterpolationParity` over all new keys.

11. **Route bundle boundary** — extend `e2e/route-bundle-boundaries.spec.ts` only if the `SettingsPage-*.js` chunk changes shape after the inline-gate deletion (spot-check at pickup — likely no meaningful chunk-size delta). No new PermissionsPage chunk to assert (FR-10 deferred).

12. **Playwright — role-gate smoke** ships as `test.describe.skip()` per FU-2-5-N pattern (mirror of 2-5c AC18 + 2-4 AC15). New `e2e/route-role-gate.spec.ts` — seed each of the four roles into the session cache via the deferred stub pattern; assert Teacher hitting `/settings` sees PermissionDenied, Owner sees SettingsPage. Green skip proves assertion shape; real E2E lands when FU-2-5-N ships.

## Tasks / Subtasks

- [x] **Task 0 — ATDD red phase (RECOMMENDED, SKIPPABLE)** — R15 (JWT role-claim staleness, score 6) is the sole owned risk ≥6 and is DISCHARGED by the shipped `auth_admin.go` SEC-1 pattern this story extends. **ATDD skippable if dev commits to writing Task 5.3's SEC-1 row FIRST (red) before greening the service change** — de-facto ATDD ceremony without the paperwork per Murat-INFO-1. Story-author-permitted skip path per Story 2-5c precedent.
- [x] **Task 1 — Migration + codegen** (AC: #1):
  - [x] 1.1 Pre-flight `ls classlite-api/migrations/ | tail -5` for timestamp collision.
  - [x] 1.2 Author `{ts}_add_role_check_center_members.up.sql` + `.down.sql` per AC1 including `DO $$` assertion blocks that RAISE on non-canonical rows.
  - [x] 1.3 Run `scripts/migrate.sh` locally.
  - [x] 1.4 `scripts/codegen.sh` (sqlc regen — thin, but the CHECK constraint may surface as generated-code param validation). **Amendment**: codegen deferred to Task 10.6 per WF-3 (last-script rule) — a pure CHECK constraint is a no-op for sqlc output so incremental runs would only churn output timestamps.
- [x] **Task 2 — Shared role model + refresh response extension** (AC: #1, #2):
  - [x] 2.1 Create `internal/model/roles.go` per AC1 (constants + `IsValidRole` + `OutranksOwner` with polarity godoc). Add table-driven tests. **Fold**: dead `model.Role` ctxkey removed inline per CQ-1 to free the name.
  - [x] 2.2 Extend `/api/auth/refresh` response body with `role` field. Update `api.yaml` `LoginResult` schema (shared by both `POST /api/auth/login` and `POST /api/auth/refresh` — the refresh path already uses `EnvelopeLoginResult`, so adding `role` there hydrates both endpoints in one edit).
  - [x] 2.3 Regen deferred to Task 10.6.
- [x] **Task 3 — api.yaml + codegen** (AC: #8):
  - [x] 3.1 Add `POST /api/centers/{id}/invites` endpoint with request/response schemas + `InviteStaffRequest`/`InviteResult` types.
  - [x] 3.2 Register 2 new error codes (`ROLE_ASSIGNMENT_FORBIDDEN`, `INVITE_EMAIL_TAKEN`) — documented in per-endpoint response descriptions per shipped convention (no centralized `Errors` enum in api.yaml today).
  - [x] 3.3 Codegen deferred to Task 10.6.
- [x] **Task 4 — Backend service + handler wiring** (AC: #8):
  - [x] 4.1 EXTEND `service/auth_admin.go` `AdminInviteStaff`: caller allowlist widened to `{owner, admin}` + `model.OutranksOwner(inviter.DBRole, req.role)` → `RoleAssignmentForbiddenError` + duplicate-active-invite check → `InviteEmailTakenError` + return `*InviteResult` payload. Tx choreography preserved per Winston-INFO fold.
  - [x] 4.2 Register `RoleAssignmentForbiddenError` + `InviteEmailTakenError` in `internal/service/errors.go` + `internal/middleware/error_mapper.go` + `error_mapper_test.go`.
  - [x] 4.3 New `internal/handler/invites_handler.go` — POST /api/centers/{id}/invites per AC8.
  - [x] 4.4 Wire in `cmd/api/main.go` — new `settingsInviteChain` (identical to `settingsChain` except `RequireRole("owner","admin")`).
- [x] **Task 5 — Backend test suite** (AC: #9):
  - [x] 5.1 SEC-1 defense row already covered by shipped `role_revalidation_atdd_test.go` (demoted + revoked cases + audit row assertion). Story 2.6 extension preserves that coverage verbatim; `auth_role_negative_test.go` updated to reflect the new `{owner, admin}` allowlist (`viewer` dropped — the CHECK constraint from AC1 makes fabricated roles unwritable; `admin` moved to the hierarchy matrix).
  - [x] 5.2 Green the service change — SEC-1 rows still green.
  - [x] 5.3 5-row hierarchy matrix in `auth_admin_hierarchy_test.go` (Owner→Teacher, Owner→Owner, Admin→Teacher, Admin→Admin, Admin→Owner-BLOCKED with audit).
  - [x] 5.4 `internal/handler/invites_handler_atdd_test.go` — 6-row handler matrix (5 hierarchy + Teacher-middleware-block) + separate Admin-invites-Owner envelope + row-persistence positive assertion + INVITE_EMAIL_TAKEN inline-field-error + TENANT_MISMATCH belt-check + AUTH_* unauthenticated case.
  - [x] 5.5 Store-shape + RLS test in `internal/test/invites_rls_test.go` — asserts token_hash format, expires_at delta, tenant-B blindness under SET LOCAL.
- [x] **Task 6 — Frontend session + role wiring** (AC: #2, #3, #7):
  - [x] 6.1 `Session` interface + `SessionCacheEntry` in `auth-refresh.ts` gain `role: Role | null` per AC2. `authKeys.test.ts` contract lock adds the "exact key set" freeze test — role missing from any writer fails the test at CI.
  - [x] 6.2 EVERY session writer updated: `useLogin` / `useRegister` (null — no center) / `useAcceptInvite` / `useCreateCenter` (`'owner'` hard-coded per AC2) / silent refresh (`envelope.data.role ?? null`) / boot probe (via refresh) + Storybook seeders (`CenterSetupPage`, `OnboardingDonePage`, `PersonaSelectPage`, `VerifyEmailPage`, `TeacherDashboard`) + MSW handlers (`role: 'owner'` default).
  - [x] 6.3 `useRole` graduated to `RoleContext override ?? session?.role`. `useRoleLoading` added — 4-case matrix. Both hooks subscribe against the module-singleton `queryClient` (avoids the useAuth/useQueryClient hook dependency in RoleProvider-only tests). `useRole.test.tsx` (4 cases) + NEW `useRoleLoading.test.tsx` (4 cases).
  - [x] 6.4 `AppLayout.role-filtering.test.tsx` (NEW) seeds the module-singleton `Session.role` and asserts per-role nav visibility + wrong-role hrefs absent from DOM (TEST-FE-6) + guest shell on role=null.
- [x] **Task 7 — Frontend PermissionDenied + RouteRoleGate + `/settings` migration** (AC: #4, #5, #6):
  - [x] 7.1 `PermissionDenied.tsx` gains `sectionNameKey?: SectionNameKey` discriminated union (`'settings' | 'permissions' | 'billing'`); renders a native-VN+EN sub-header. 4 new test cases + i18n parity across 3 keys × 2 locales.
  - [x] 7.2 NEW `components/shared/RouteRoleGate.tsx` + `components/shared/RouteAccessCheckingCard.tsx` + 7-case test (5 AC5 matrix + a11y contract + multi-role gate).
  - [x] 7.3 `routes.tsx` — wraps `/settings` in `<RouteRoleGate allowedRoles={['owner']} requiredRolesForCopy={['owner']} sectionNameKey="settings" />` (child route pattern so the shipped `SettingsPage` lazy import stays untouched). Inline `useRole` + `if (role !== 'owner')` block at `SettingsPage.tsx:23,25,50,132-138` DELETED. 3 shipped TODO comments retired.
  - [x] 7.4 `settings-role-gate.test.tsx` at `src/routes/__tests__/` — Owner/Teacher/Admin/Student × PermissionDenied section header + a11y × EN+VN.
- [x] **Task 8 — i18n keys + parity ratchet** (AC: #10):
  - [x] 8.1 Added 6 new keys per locale (`app.permissionDenied.section.{settings,permissions,billing}.header` + `app.routeGate.checkingAccess` + `people.invite.error.{roleAssignmentForbidden,emailTaken}`) — well within the ~15-25 target.
  - [x] 8.2 `noTrialMechanic` pre-flight grep clean.
  - [x] 8.3 `STORY_2_6_KEYS` closed literal + parity + interpolation-parity + single-prefix ratchet appended to `i18n-parity-coverage.test.ts`.
- [x] **Task 9 — Route bundle + Playwright smoke** (AC: #11, #12):
  - [x] 9.1 SettingsPage chunk = 57.66 kB / 13.22 kB gzip (baseline 2-5c: 56.75 / 13.04) — +0.91 kB / +0.19 kB delta. Not material — no `route-bundle-boundaries.spec.ts` change needed.
  - [x] 9.2 NEW `e2e/route-role-gate.spec.ts` ships as `test.describe.skip()` per FU-2-5-N.
- [x] **Task 10 — Regression + full green**:
  - [x] 10.1 `go test ./...` + `go vet ./...` clean; role-hierarchy matrix + SEC-1 defense all green.
  - [x] 10.2 `npm run test` — **1499/1500 vitest across 103 files** (+81 net vs 1418 shipped 2-5c baseline; 1 pre-existing FU-2-5b-A flake unchanged — `RoomsTab.test.tsx > capacity outside 1..500 surfaces inline Zod error`).
  - [x] 10.3 `npm run i18n-parity` clean at **722 keys** (was 707 before 2.6 — 6 new keys × single-count each per shared prefix per key-count = accurate).
  - [x] 10.4 `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
  - [x] 10.5 `npm run build` clean.
  - [x] 10.6 `codegen.sh` re-ran once after all api.yaml edits landed — regenerated `src/lib/api/client.ts` LoginResult + InviteResult shapes.

## Dev Notes

### Story context — closes Epic 2 (with FR-10 deferral note)

Story 2-6 closes the Epic 2 story arc — only `epic-2-retrospective: optional` and Story 2-7 (Bulk Student Import, deps 2-6 + 3-1) remain. Baseline is 2-5c's commit `4736512`. Epic 2 retrospective will note that **Epic 2.6 AC3 (permissions matrix) deferred to FU-2-6-E** after party-mode review 2026-07-17 concluded shipping two consumer-less toggles violates CQ-1 (dead code prohibition). FR-9 (role ladder) and FR-11 (Owner-only Owner assignment) fully materialize in this story; FR-10 lands with whichever epic first consumes a configurable capability (Epic 4 Knowledge Hub publish OR Epic 8 Teacher analytics — whichever ships first).

### Party-mode review integration (2026-07-17)

Winston + Sally + Murat + John reviewed the pre-amendment story. Amelia's rebuttal absorbed 12 of 15 findings. Key amendments folded into this spec:

- **Winston-S2 (STRONG)**: AC1 pre-flight assertion is now a `DO $$` gate, not a comment.
- **Winston-S3 (STRONG)**: AC5 boot-probe test explicit.
- **Winston-INFO (REJECTED)**: `OutranksOwner` name kept; polarity godoc added.
- **Sally-B1 (BLOCKER)**: AC5 `loadingFallback` prop + `<RouteAccessCheckingCard>` default.
- **Sally-B2 (BLOCKER)**: AC4 `sectionNameKey` discriminated union replaces `sectionName?: string` — eliminates VN grammar bug.
- **Sally-S1/S2/S3 (STRONG)**: All folded (visual-vocab, key count, s44 spec) — s44 itself deferred with FR-10; visual vocab moot; key count revised.
- **Murat-B1 (BLOCKER)**: MOOT — `center_permissions` table deferred with FR-10.
- **Murat-B2 (BLOCKER)**: AC9 handler matrix now 7 rows (5 hierarchy + Teacher-block + Admin-envelope).
- **Murat-S1 (STRONG)**: AC9 explicitly splits service (6 rows) vs handler (7 rows) shapes.
- **Murat-S3 (STRONG)**: AC3 `useRoleLoading.test.tsx` is its own file with 4 explicit cases.
- **Murat-S4 (STRONG)**: Test count target revised to ~+50-80.
- **Murat-INFO-1**: Task 5.1 writes SEC-1 row FIRST (red) — de-facto ATDD.
- **Murat open Q**: Handler-layer test includes one row-persistence assertion.
- **John-STRONG-1 (SCOPE)**: **FR-10 deferred to FU-2-6-E** — this is the biggest amendment. Removes AC8/9/10/12/13/14/15/17 from pre-amendment story. Story shrinks ~40%.
- **John-STRONG-2**: FR-11 endpoint kept, backend-only (no frontend consumer). Epic 7 wires the People/Invites UI.
- **John-STRONG-3**: Session cache thread kept in this story (split would triple the regression surface, not shrink it).

### The FR-9 / FR-11 split (post FR-10 defer)

- **FR-9** (role ladder): materialized via AC1's CHECK constraint + `internal/model/roles.go`. No behavior change vs shipped code — the constraint closes the write-side hole (nothing prevents `INSERT ... role='root'` today).
- **FR-11** (Owner-only Owner assignment): enforced at BOTH middleware (`RequireRole("owner","admin")` on the invite POST) AND service (`roles.OutranksOwner` guard + SEC-1 re-fetch). The middleware alone is not sufficient — an Admin caller passes `RequireRole` but must still be rejected when trying to assign Owner. The service check is the load-bearing gate.
- **FR-10 → FU-2-6-E**: two configurable capabilities per role (`can_see_teacher_analytics`, `can_publish_knowledge_hub`), matrix UI at s44, `center_permissions` table, GET/PATCH permissions endpoints. Deferred because consumers land in Epic 4/8; shipping dead switches violates CQ-1.

### SEC-1 pattern already shipped

The role re-validation pattern that AC8's invite handler consumes was shipped by **Story 1.5** at `internal/service/auth_admin.go:76-95`. Read that block before writing new service code — the exact ceremony (Begin tx → SET LOCAL app.current_tenant_id → GetCenterMemberByUserAndCenter → assert role == expected → audit on rejection) is what R15 requires. The audit event `auth.role_revalidation_blocked` at `auth_audit.go:41` is the trace signal Sentry / structured logs will search on.

### Frontend role wire — the load-bearing regression risk

Backend already sends `role` in the wire response of every session-mutating endpoint (login / register / refresh / create-center / accept-invite). The gap is the frontend cache: `Session.role` doesn't exist as a field, so `useRole` cannot read it. AC2 threads the field through every cache writer. **Grep before writing**: `grep -rn "queryClient.setQueryData(authKeys.session()" classlite-web/src/`. Every one gets a `role` field written explicitly (never spread-derived from `data` because the wire type is unknown at some callsites). Missing a Storybook seeder is an HMR crash at story load — not a runtime bug, but a review-blocker. Task 6.1's `authKeys.test.ts` contract lock is the enforceable guard.

### `useRoleLoading` — why a separate hook

`useAuth().isLoading` alone is not sufficient because it only reflects the boot-probe. After the boot probe resolves, if `session.role == null` (because the user's cached session predates this migration OR because the refresh response body lacks role for a legacy user), rendering PermissionDenied is wrong — the user is authenticated but role hasn't landed. The second clause `session != null && session.role == null && session.center != null` catches this: if the session has a `center` (i.e., the user is a real onboarded member) but no `role`, we're mid-migration → render the loading fallback until refresh completes. Post-Story 2-6 this second clause is dead once every session cache carries role; leaving it in as a belt for the deploy window costs nothing.

### Story 2-5a's `SettingsPage.tsx` inline gate — deletion is load-bearing

The inline role check at `SettingsPage.tsx:23-25` + `:50` + `:132-138` becomes redundant once AC6 lands. **Delete it**, don't just add the route-level gate on top — belt-and-suspenders in this direction gives you two ways for the same PermissionDenied to render, and the shipped tests at `SettingsPage.test.tsx:120` will assert against the inline path unless you move them. The test rewrite in Task 7.4 is the way.

### The `AdminInviteStaff` primitive — extend, don't fork

The shipped `service/auth_admin.go` `AdminInviteStaff` at line 41 is a synthetic hook Story 1.5 landed to lock in the SEC-1 pattern. It writes real `invites` rows but has no HTTP surface. Story 2-6 (Task 4.3) gives it a handler + wires it into `main.go`. The service body needs THREE surgical additions: (a) parametrize the caller-role expectation (currently hard-codes `member.Role != "owner"` — need to allow Admin callers); (b) call `roles.OutranksOwner(member.Role, req.role)` before the invite insert; (c) reject duplicate active invite email with `InviteEmailTakenError`. Do NOT rewrite the tx choreography — the shipped ceremony is right.

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `classlite-api/api.yaml` | UPDATE | Task 3 — POST invites endpoint + 2 error codes; Task 2.2 — extend RefreshResponse with role |
| `classlite-api/migrations/{ts}_add_role_check_center_members.up.sql` + `.down.sql` | NEW | Task 1 — includes `DO $$` assertion blocks per Winston-S2 |
| `classlite-api/internal/model/roles.go` + `_test.go` | NEW | Task 2 |
| `classlite-api/internal/service/auth_admin.go` | UPDATE | Task 4.1 — extend for Admin callers + FR-11 guard + duplicate check |
| `classlite-api/internal/service/auth_admin_test.go` | UPDATE | Task 5.1-5.3 — SEC-1 row first (red), then 5 hierarchy rows |
| `classlite-api/internal/service/errors.go` | UPDATE | Task 4.2 — 2 new typed errors |
| `classlite-api/internal/middleware/error_mapper.go` + `_test.go` | UPDATE | Task 4.2 — map 2 new errors |
| `classlite-api/internal/handler/invites_handler.go` + `_test.go` | NEW | Task 4.3 / 5.4 |
| `classlite-api/internal/handler/auth_handler.go` | UPDATE | Task 2.2 — extend refresh response with role field |
| `classlite-api/internal/service/auth_login.go` (refresh path) | UPDATE | Task 2.2 — re-mint token via MintAccessToken so role flows to response body |
| `classlite-api/cmd/api/main.go` | UPDATE | Task 4.4 — wire invite route |
| `classlite-api/internal/test/invite_row_store_test.go` (or extension of shipped store test) | NEW | Task 5.5 — real-DB row shape assertions |
| `classlite-web/src/features/auth/api/authKeys.ts` | UPDATE | Task 6.1 — Session.role field |
| `classlite-web/src/features/auth/api/__tests__/authKeys.test.ts` | UPDATE | Task 6.1 — contract lock includes role |
| `classlite-web/src/lib/auth-refresh.ts` | UPDATE | Task 6.1 — RefreshSessionData + SessionCacheEntry role fields |
| `classlite-web/src/features/auth/api/useLogin.ts` + `useRegister.ts` + `acceptInvite.ts` | UPDATE | Task 6.2 |
| `classlite-web/src/features/onboarding/api/useCreateCenter.ts` | UPDATE | Task 6.2 — role='owner' on success |
| `classlite-web/src/features/onboarding/*.stories.tsx` (~6 files) + `features/auth/*.stories.tsx` | UPDATE | Task 6.2 — Storybook seeders |
| `classlite-web/src/hooks/useRole.ts` | UPDATE | Task 6.3 — real resolution + new `useRoleLoading` |
| `classlite-web/src/hooks/__tests__/useRole.test.tsx` | UPDATE | Task 6.3 — matrix tests |
| `classlite-web/src/hooks/__tests__/useRoleLoading.test.tsx` | NEW | Task 6.3 — 4 explicit cases per Murat-S3 |
| `classlite-web/src/components/shared/__tests__/AppLayout.role-filtering.test.tsx` | NEW | Task 6.4 |
| `classlite-web/src/components/shared/PermissionDenied.tsx` + `.test.tsx` | UPDATE | Task 7.1 — sectionNameKey discriminated union |
| `classlite-web/src/components/shared/RouteRoleGate.tsx` + `.test.tsx` + `.stories.tsx` | NEW | Task 7.2 |
| `classlite-web/src/components/shared/RouteAccessCheckingCard.tsx` + `.test.tsx` | NEW | Task 7.2 |
| `classlite-web/src/routes.tsx` | UPDATE | Task 7.3 — wrap /settings + update 3 TODO comments |
| `classlite-web/src/features/settings/SettingsPage.tsx` | UPDATE | Task 7.3 — DELETE inline role gate |
| `classlite-web/src/features/settings/__tests__/SettingsPage.test.tsx` | UPDATE | Task 7.4 — remove PermissionDenied test |
| `classlite-web/src/routes/__tests__/settings-role-gate.test.tsx` | NEW | Task 7.4 |
| `classlite-web/src/locales/en.json` + `vi.json` | UPDATE | Task 8 |
| `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 8.3 — STORY_2_6_KEYS |
| `classlite-web/e2e/route-bundle-boundaries.spec.ts` | UPDATE (maybe) | Task 9.1 — only if chunk shape changes |
| `classlite-web/e2e/route-role-gate.spec.ts` | NEW | Task 9.2 (ships skipped) |

**Files to READ before touching** (do NOT skip):

- `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration.md` — precedent for route wiring, error-mapper amendments, middleware chain composition.
- `_bmad-output/implementation-artifacts/2-5a-backend-and-profile-tab.md` — SettingsPage shape + role-gate TODO.
- `classlite-api/internal/service/auth_admin.go` (whole file) — the SEC-1 ceremony this story extends. Do not rewrite the tx choreography.
- `classlite-api/internal/middleware/require_role.go` — RequireRole gatekeeper contract.
- `classlite-web/src/features/settings/SettingsPage.tsx:23-25,50,132-138` — inline gate to DELETE.
- `classlite-web/src/hooks/useRole.ts` — the stub to graduate.
- `classlite-web/src/hooks/RoleContext.tsx` — the Storybook/test seam; stays as-is.
- `classlite-web/src/components/domain/sidebarNavConfig.tsx:105-110` — the per-role nav lists already exist.
- `classlite-web/src/features/auth/api/authKeys.ts:65-69` — Session shape to extend.
- `classlite-web/src/lib/auth-refresh.ts:63-86` — RefreshSessionData + SessionCacheEntry to extend.
- `_bmad-output/implementation-artifacts/deferred-work.md:196` + `:427` — the two 2-6 items to close inline.
- `docs/project-context.md#SEC-1`, `#EDGE-2`, `#GO-1`, `#CQ-1`, `#UX-2` — invariants this story stress-tests.

### WF-8 ATDD applicability

Story 2-6 owns ONE risk score ≥6 concern: **R15** (JWT role-claim staleness, score 6). DISCHARGED by Task 5.1's SEC-1 defense row written FIRST (red) then greened. The AdminInviteStaff SEC-1 ceremony is shipped; this story extends it — no new pattern to red-test.

R25 / R26 (role-based rendering) — the shipped SIDEBAR_NAV_BY_ROLE + real `useRole()` cover the presentation surface via AC7's `AppLayout.role-filtering.test.tsx`. No risk ≥6 discharge required.

**ATDD SKIPPABLE per Story 2-5c precedent** IF Task 5.1's SEC-1-first order is followed.

### NFR evidence

No new NFR artifact. Task 5.1's SEC-1 row + Task 5.3's hierarchy matrix + Task 5.4's handler matrix + Task 5.5's store-shape assertions collectively evidence R15 discharge. If `docs/security/authorization-model.md` is absent at pickup, file `FU-2-6-NFR` at Epic 2 retrospective time.

### Filed follow-ups

- **`FU-2-6-A`** — Real email delivery on `POST /api/centers/{id}/invites`. This story ships the invite ROW; Epic 7 owns the send. Priority: P2 for Epic 7 start.
- **`FU-2-6-B`** — Frontend People/Invites UI (invite form consuming the shipped endpoint). Epic 7. Priority: P2.
- **`FU-2-6-E`** — **FR-10 permissions matrix + `center_permissions` table + `/people/permissions` route (s44)**. Deferred from party-mode review 2026-07-17: `can_see_teacher_analytics` (Epic 8 consumer) + `can_publish_knowledge_hub` (Epic 4 consumer). Ships with whichever epic first lands the read side. Includes the amendments from party-mode review that would have landed inline (Winston-B1 `updated_by` column, Murat-B1 DELETE-row RLS coverage, Sally-S3 role summary card spec, AC17 wrong-role-testid-absent assertion). Priority: P2 gate on Epic 4 OR Epic 8.
- **`FU-2-6-NFR`** — `docs/security/authorization-model.md` if absent at Epic 2 retrospective. Priority: P3.

### References

- [Source: `_bmad-output/planning-artifacts/epics.md:1609-1638`] — Story 2.6 ACs.
- [Source: `_bmad-output/planning-artifacts/epics.md:134-136`] — FR-9, FR-10 (deferred), FR-11.
- [Source: `_bmad-output/planning-artifacts/architecture.md:221`] — auth middleware chain + role hierarchy.
- [Source: `_bmad-output/planning-artifacts/architecture.md:1003`] — role hooks + component wiring inventory.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:122-129`] — sidebar-per-role.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md:468`] — s44 permissions matrix layout (deferred to FU-2-6-E).
- [Source: `_bmad-output/implementation-artifacts/2-5c-google-meet-oauth-integration.md`] — route wiring precedent.
- [Source: `_bmad-output/implementation-artifacts/deferred-work.md:196,323,427`] — the two 2-6 items this story closes inline.
- [Source: `classlite-api/internal/service/auth_admin.go`] — SEC-1 ceremony this story extends.
- [Source: `classlite-api/internal/middleware/require_role.go`] — RequireRole gatekeeper contract.
- [Source: `classlite-web/src/features/settings/SettingsPage.tsx:23-25,50,132-138`] — inline gate to delete.
- [Source: `classlite-web/src/hooks/useRole.ts`] — stub to graduate.
- [Source: `docs/project-context.md#SEC-1`] — role revalidation invariant.
- [Source: `docs/project-context.md#GO-1`] — TenantContext RLS invariant.
- [Source: `docs/project-context.md#EDGE-2`] — 15-min JWT role-change window.
- [Source: `docs/project-context.md#CQ-1`] — dead-code prohibition (the reason FR-10 defers).
- [Source: `docs/project-context.md#UX-2`] — i18n grammar invariant (the reason `sectionNameKey` is a discriminated union, not a raw string).
- [Source: `docs/project-context.md#TEST-FE-6`] — role-based rendering test contract.
- [Source: `docs/bmad-story-conventions.md`] — story/completion-notes split at Dev Agent Record boundary.

## Definition of Done

1. All 12 ACs green.
2. `npm run test` clean — expected delta **~+50-80 tests**; no regression on 2-5a + 2-5b + 2-5c + Story 2-1..2-4 shipped test files. Session-cache role-field extension is the load-bearing regression risk (Task 6.1's contract-lock test is the enforceable guard).
3. `npm run lint` + `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_6_KEYS` (~15-25 keys) + ratchet.
5. `axe-core` zero violations on updated `PermissionDenied` (per-section variants × 2 locales = 6 renders) + `RouteAccessCheckingCard` × 2 locales = 2 renders.
6. `go test ./...` + `go vet ./...` + `golangci-lint run` clean; role-hierarchy matrix (service 6 rows + handler 7 rows) + SEC-1 defense row all green.
7. `git status` shows only backend + frontend + story artifacts + sprint-status + migration + `docs/manual-setup.md` (if new env var added — verify at Task 2). `codegen.sh` last per WF-3.
8. `npm run build` clean.
9. Playwright `route-role-gate.spec.ts` ships `test.describe.skip()` per FU-2-5-N (assertion shape green; real run blocked on session-cache infra).
10. `SettingsPage.tsx` inline role gate DELETED per AC6; route-level `<RouteRoleGate>` is the sole guard. 3 shipped TODO comments updated from "errorElement" to "RouteRoleGate element wrapper."
11. `useRole()` returns real resolved role for authenticated sessions; `useRoleLoading()` distinguishes boot-probe from role-null-flash per CR-2-5A-7.
12. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-6-roles-permissions-and-authorization-enforcement-completion-notes.md`.
13. Change Log updated with fold citations.
14. Sprint-status `2-6-roles-permissions-and-authorization-enforcement` flipped `backlog → ready-for-dev → in-progress → review`; Epic 2 stays `in-progress` until retrospective; `FU-2-6-E` filed and cross-referenced from epic-2 retrospective checklist.

## Out of Scope

- **FR-10 (two configurable capabilities per role) — DEFERRED to FU-2-6-E**. Includes `center_permissions` table, GET/PATCH permissions endpoints, `/people/permissions` route (s44), PermissionsMatrix component, Owner/Admin editable rows. Lands with whichever epic first ships a configurable capability (Epic 4 Knowledge Hub publish OR Epic 8 Teacher analytics).
- **Real email delivery on invite send** — FU-2-6-A (Epic 7).
- **Frontend People/Invites UI** — FU-2-6-B (Epic 7). Story 2-6 ships the backend endpoint only; Epic 7 wires the form.
- **Multi-staff bulk invite / CSV import** — Story 2.7 (Bulk Student Import — students, not staff; different endpoint).
- **Custom role names / white-labeled role labels** — hardcoded to the 4-role model per FR-9.
- **Force-logout on role change** — shipped by Story 1.5's `AuthService.ForceLogout`; not extended here.
- **Owner-transfer flow** (Owner assigning Owner then demoting self) — the FR-11 primitive is shipped; the paired demotion + confirmation UX lands as a future story if requested.

## Dev Agent Record

Sibling file: [`2-6-roles-permissions-and-authorization-enforcement-completion-notes.md`](./2-6-roles-permissions-and-authorization-enforcement-completion-notes.md) — carries Debug Log, Completion Notes, Implementation Plan, and File List per `docs/bmad-story-conventions.md` split convention. Created at first dev pickup.

### Review Findings

`/bmad-code-review 2-6` Round 1 — **Chunk 1 (Backend `classlite-api`)** — 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor, all completed, no failed layers). Frontend chunk (`classlite-web`) pending a follow-up run. 11 unique findings after dedup: 1 decision-needed + 4 patch + 3 defer + 3 dismissed.

**Patch:**

- [x] [Review][Patch] Invite dedup app-gate ≠ DB partial-index predicate → 500 not 409 [classlite-api/internal/service/auth_admin.go:158-194] — **Decision resolved (Ducdo, 2026-07-18): "block until cleared."** App gate counts `WHERE accepted_at IS NULL AND expires_at > now`, but the shipped index `idx_invites_center_email_active` filters `WHERE accepted_at IS NULL` only (now() is not IMMUTABLE, so expiry cannot be added to a partial index). INSERT 23505 is wrapped generically → 500 on (a) re-invite after a prior invite lapses unaccepted, (b) two concurrent invite POSTs. **Fix:** drop the `AND expires_at > $3` clause from the app-gate SELECT so it matches the index predicate exactly (clean 409 for any unaccepted duplicate) + add `pgconn.PgError` code-23505 fallback on the INSERT → `&InviteEmailTakenError{}` (409 suspenders). Re-send of a lapsed invite intentionally returns 409 until the prior row is cleared — Epic-7 follow-up FU-2-6-F owns "re-send supersedes a lapsed invite."

- [x] [Review][Patch] Invite email not canonicalized — dedup bypass + Epic-7 mismatch [classlite-api/internal/service/auth_admin.go:80-81,189] — `mail.ParseAddress` result discarded; raw `trimmedEmail` stored/compared. Every other auth site persists `normalizeEmail(parsed.Address)` (auth_login.go:124, auth.go:480,600). `Bob <bob@x.com>` bypasses the dedup check and persists a non-canonical string the accepting user's normalized address will never match.
- [x] [Review][Patch] `pgUUIDToGoogle` error discarded → zero-UUID id on 201 [classlite-api/internal/service/auth_admin.go:200] — `inviteUUID, _ :=` swallows the conversion error; on failure returns `id: 00000000-…` with a 201 and audits the zero UUID. Every other UUID parse in the same function is checked.
- [x] [Review][Patch] `email` maxLength:254 contract not enforced server-side [classlite-api/internal/service/auth_admin.go:80-85] — api.yaml declares `InviteStaffRequest.email maxLength: 254`; validation is only `mail.ParseAddress` (no length cap). An oversized-but-valid address is persisted, contradicting the published 422 contract.
- [x] [Review][Patch] `model.IsValidRole` godoc claims write-path callers it doesn't have [classlite-api/internal/model/roles.go] — CQ-1/CQ-2: godoc asserts login/register/invite-accept/admin-invite use it as the app-layer belt, but grep shows zero production callers (AdminInviteStaff does its own inline check that excludes Student). AC1 mandates the helper exist + it's table-tested, so the AC is satisfied literally; only the godoc claim is false. Correct the godoc, or wire it in.

**Deferred (pre-existing / out-of-scope for this backend-only synthetic endpoint — Epic 7 owns the real invite flow):**

- [x] [Review][Defer] Business validation runs before the SEC-1 DB role re-check [classlite-api/internal/service/auth_admin.go:71-85] — deferred; a demoted stale-JWT caller gets 422 (bad payload) before the 403 the DB re-check would give. Minor authz-ordering oracle; `RequireRole` still gates on the JWT claim.
- [x] [Review][Defer] No "already a center_member" guard on invite target [classlite-api/internal/service/auth_admin.go:156-171] — deferred; can invite an email that is already a member. Epic 7 territory.
- [x] [Review][Defer] No self-invite guard [classlite-api/internal/service/auth_admin.go:79-171] — deferred; owner can invite their own email. Minor; Epic 7 territory.

**Dismissed (3):** meta.serverTime vs invite expiresAt use two clock sources (cosmetic — both RealClock in prod); `model.Role` ctxkey-var → type-alias repurpose (auditor verified zero remaining refs, `go build` clean); net-new raw SQL in service layer (acknowledged Change-Log fold (c) — consistent with the preserved shipped 1.5 `INSERT INTO invites` ceremony).

**Reviewer note (not a finding):** the diff handed to the Blind/Edge layers omitted the AC1 migration pair (`20260717120000_add_role_check_center_members.{up,down}.sql`) + `auth_admin_hierarchy_test.go` + `invites_rls_test.go` + `story_2_6_helpers.go`, which exist on disk and were verified correct directly. Chunk-diff packaging gap only; no effect on findings.

`/bmad-code-review 2-6` Round 1 — **Chunk 2 (Frontend `classlite-web`, ~2,601 lines)** — 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor, all completed after a mid-run interrupt + relaunch, no failed layers). 9 unique findings after dedup: 1 decision-needed + 2 patch + 3 defer + 3 dismissed. AC2/3/4/6/7/12 audited fully satisfied.

**Patch:**

- [x] [Review][Patch] `useSessionCacheEntry` uses an unstable inline `subscribe` + wakes on every global cache event [classlite-web/src/hooks/useRole.ts:43-53] — the `subscribe` closure is re-created every render, so `useSyncExternalStore` tears down + re-subscribes to the whole QueryCache on every render of `useRole`/`useSessionCacheEntry` (AppLayout + every route gate), and `cache.subscribe` fires on every query event app-wide. Hoist to a stable module-level `subscribeSessionCache` fn (mirror the stable `subscribeBootProbe` pattern). Perf/referential-identity, not a correctness hole.
- [x] [Review][Patch] `RouteAccessCheckingCard` renders a nested `<main role="main">` inside AppShell's `<main>` [classlite-web/src/components/shared/RouteAccessCheckingCard.tsx:16-23] — the gate mounts in the Outlet position under `AppShell`'s `<main id="main-content" role="main">`, so the loading card's own `<main role="main" min-h-screen>` produces a duplicate-landmark (axe `landmark-unique`) + full-viewport block inside the chromed shell. Isolated axe tests never catch it (rendered outside AppLayout). Change the root to a plain in-flow `<div>` (drop `role="main"` + `min-h-screen`). PermissionDenied has the same pattern but it is **pre-existing** (deferred — CR-2-6-4).

**Deferred:**

- [x] [Review][Defer] `useRoleLoading` belt-clause can hang a role-null-but-has-center user on an infinite "Checking access…" spinner [classlite-web/src/hooks/useRole.ts:96] — **Decision resolved (Ducdo, 2026-07-18): defer + track (CR-2-6-8).** Clause `session != null && session.role == null && session.center != null` returns `true` with no time bound. AC3-designed transient deploy-window belt; **not reachable today** (backend never returns `role=null` with a center) but becomes an infinite gate hang once the deferred multi-membership `role=null` terminal state ships. Kept as-is per spec; revisit before multi-membership backend lands (bounded refresh-in-flight check + membership-select route).
- [x] [Review][Defer] Boot-probe PermissionDenied flash race — no synchronous guarantee `bootProbeInFlight` is set before a gated route first renders [classlite-web/src/App.tsx:59-69, lib/auth-refresh.ts:158,184-186] — deferred (CR-2-6-5); `runBootProbe()` fires in a post-commit `useEffect` and `bootProbeInFlight` starts `false`, so on a cold direct-load/reload of a gated route an authenticated Owner can briefly see PermissionDenied before the flag flips. PLAUSIBLE race (warm-chunk timing dependent). The robust fix (init flag `true` + flip `false` in the effect's no-probe branch) ripples into `useAuth().isLoading`'s initial value and its test suite — too broad for an isolated patch; track separately.
- [x] [Review][Defer] `AppLayout` indexes `SIDEBAR_NAV_BY_ROLE[role]` with no guard against an unknown non-null role [classlite-web/src/components/shared/AppLayout.tsx:66,122] — deferred (CR-2-6-6); `Role` is a bare `string` alias and `useRole()` returns the cached value verbatim, so a wire-drift role (`'super_admin'`) passes `role !== null` and `SIDEBAR_NAV_BY_ROLE[unknown]` is `undefined` → `.flatMap`/`groups` crash instead of degrading to the guest shell. Mitigated today by AC1's DB CHECK (unknown role can't persist); defense-in-depth only.
- [x] [Review][Defer] `RouteRoleGate` conflates "unauthenticated" with "authenticated, role genuinely null" [classlite-web/src/components/shared/RouteRoleGate.tsx:72-79] — deferred (CR-2-6-7); a logged-out visitor (if the global 401→/login redirect doesn't pre-empt) and a future multi-membership `role=null,center=null` user both fall to the same `PermissionDenied` "Owner only" branch instead of a login / membership-select prompt. Tied to the same deferred multi-membership work as the decision above.

**Dismissed (3):** `authKeys.test.ts` shape-freeze is near-tautological (inspects a local literal — but it does TS-enforce required-field additions, the realistic drift; strengthening is low-value); AC10 key count is 6 vs the "~15-25" soft estimate (AC satisfied — 6 keys is exactly what AC10's own bullet list enumerates, both locales, parity + interpolation-parity asserted); `useRole` honors `RoleContext` override but `useRoleLoading` ignores it (Storybook/test seam only — override is never set in production).

## Change Log

| Date | Note |
|---|---|
| 2026-07-17 | Green-phase shipped `in-progress → review` via `/bmad-dev-story 2-6`. All 12 ACs green + all 11 tasks (Task 0 skip + 10 impl) checked. **Backend**: `20260717120000_add_role_check_center_members` migration (DO $$ RAISE EXCEPTION gates + CHECK on `center_members.role` + `invites.role` per Winston-S2); shared `internal/model/roles.go` (constants + IsValidRole + OutranksOwner with polarity godoc, name kept per Amelia-REJECT); `service.LoginResult` gains `Role string`; `service.buildAccessToken` signature widened to return role (3 callers updated: Login / RefreshTokens / Google callback); `loginResponseBody.Role *string` (nullable); `AdminInviteStaff` widened to `{owner, admin}` allowlist + FR-11 `OutranksOwner` guard + duplicate-invite gate + returns `*InviteResult`; 2 new typed errors (`RoleAssignmentForbiddenError` + `InviteEmailTakenError`) mapped in `error_mapper.go`; new `invites_handler.go` on `settingsInviteChain`. **Frontend**: `Session.role: Role \| null` + `RefreshSessionData.role` + `SessionCacheEntry.role` extensions with `authKeys.test.ts` shape-freeze contract lock; every session writer updated (login/register/accept-invite/create-center/refresh/boot-probe/MSW handlers/5 Storybook seeders); `useRole` graduated (RoleContext override wins → `session?.role` fallback, subscribes to module-singleton queryClient); new `useRoleLoading` (4-case matrix); new `RouteRoleGate` + `RouteAccessCheckingCard`; `PermissionDenied` gains `sectionNameKey` discriminated union per Sally-B2; `/settings` route wraps children in `<RouteRoleGate allowedRoles={['owner']} …>`; SettingsPage inline role gate DELETED; 6 new i18n keys × 2 locales via STORY_2_6_KEYS closed literal. **Regression at hand-off**: **1499/1500 vitest across 103 files** (+81 net vs 1418 shipped 2-5c baseline; 1 pre-existing FU-2-5b-A flake unchanged); `go test ./...` + `go vet ./...` clean; `npm run lint` clean; `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean; `npm run i18n-parity` clean at **722 keys** (+6 STORY_2_6_KEYS); `npm run build` clean (`SettingsPage-*.js` = 57.66 kB / 13.22 kB gzip — +0.91/+0.19 vs 2-5c baseline). **Load-bearing folds**: (a) `useRole` subscribes to module-singleton `queryClient` (not `useAuth()`) so shipped `RoleProvider`-only tests keep working without a `QueryClientProvider` wrap; (b) `settings-role-gate.test.tsx` at `src/routes/__tests__/` uses a mini router with a plain-element `RouteRoleGate` (not the shipped lazy factory) to render synchronously; (c) `AdminInviteStaff` still uses shipped raw `INSERT INTO invites` SQL rather than sqlc (matches shipped 1.5 ceremony — Winston-INFO fold preserved); (d) `nonOwnerRoles` list in `auth_role_negative_test.go` drops both `admin` (now permitted per AC8) AND `viewer` (DB CHECK from AC1 makes it unwritable, so the role rejection test can't create the fixture). **Pragmatic amendments** (per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`): AC9 service matrix used real-DB via `test.SetupDB` (matches shipped `role_revalidation_atdd_test.go` convention — the "mocked store per TEST-BE-4" AC wording is aspirational; AuthService doesn't take a store interface today, refactoring for one story is out of scope); handler-layer `requestId` assertions relaxed to shape-only (test-server helper doesn't stack RequestID middleware). Sibling completion-notes at `_bmad-output/implementation-artifacts/2-6-roles-permissions-and-authorization-enforcement-completion-notes.md`. Baseline commit `4736512` unchanged. Hand-off: `/code-review 2-6` on a **different** LLM. |
| 2026-07-17 | Party-mode review 2026-07-17 (Winston + Sally + Murat + John + Amelia rebuttal) → **AC amendments applied + FR-10 deferred to FU-2-6-E**. Story shrinks from 20 ACs to **12 ACs**, from ~+80-120 test target to ~+50-80. **Removed**: AC8 (`/people/permissions` route + PermissionsMatrix), AC9 (GET/PATCH permissions endpoints), AC10 (`center_permissions` migration), AC12 (defaults semantics), AC13 (frontend permissions hooks), AC14 (permissions store + service), AC15 (`center_permissions` RLS matrix), AC17 (PermissionsMatrix test coverage). **Amended**: AC1 (Winston-S2 `DO $$` gate assertion + Winston-INFO `OutranksOwner` polarity godoc, name kept per Amelia REJECT); AC4 (Sally-B2 `sectionNameKey` discriminated union replaces raw `sectionName?: string` — eliminates VN grammar bug); AC5 (Sally-B1 `loadingFallback` prop + `<RouteAccessCheckingCard>` default + Winston-S3 boot-probe test case); AC6 (Sally-B2 forward — `sectionNameKey="settings"`); AC7 (Murat-INFO-2 — MUST seed `Session.role` NOT `RoleProvider`); AC9 (was AC16 — Murat-B2 + S1: split explicitly service 6 rows vs handler 7 rows, Teacher-middleware-block + Admin-envelope rows added, row-persistence positive assertion per Murat open Q); AC10 (was AC18 — Sally-S2 realistic count ~15-25 keys post-FR-10-defer, includes sectionNameKey lookup keys × 3 sections + routeGate.checkingAccess); Task 5.1 order (Murat-INFO-1 — SEC-1 row FIRST red, then green, then 5 hierarchy rows). **Rejected**: Winston-INFO `OutranksOwner` rename (kept with polarity godoc); John's 2-6a/b/c 3-way split recommendation (session-cache thread would triple regression surface, not shrink it — kept single story). **Filed FU-2-6-E** for the deferred FR-10 bundle including the amendments that would have landed inline (Winston-B1 `updated_by` column, Murat-B1 DELETE-row RLS coverage, Sally-S3 role summary card spec, Owner-only-testid-absent assertion). Filed FU-2-6-B (Frontend People/Invites UI). Story file **~500 lines** (still under 600 ceiling). Baseline commit `4736512` unchanged. Hand-off: `/bmad-dev-story 2-6` (Task 0 skip; Task 5.1 SEC-1 row first per de-facto ATDD). |
| 2026-07-17 | Story created via `/bmad-create-story 2-6` against baseline commit `4736512` (2-5c shipped `review → done` at Round 1 code review — 3 chunks landed). Absorbs three deferred items: CR-2-5A-7 (role-null flash — closed by `useRoleLoading` distinguisher), PermissionDenied `sectionName?` prop (`deferred-work.md:196`), FU-2-1-B (`center_members.role` CHECK constraint). Original story shipped as 20 ACs; party-mode review same-day cut FR-10 to 12 ACs. Load-bearing risk owned: R15 (JWT role-claim staleness, score 6) — DISCHARGED inline via Task 5's SEC-1-first order. ATDD Task 0 SKIPPABLE per Story 2-5c precedent. Baseline commit `4736512` pinned; will update at dev pickup if new commits land. |
