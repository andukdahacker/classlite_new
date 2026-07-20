---
baseline_commit: dfa65f0
---

# Story 3.1: Class CRUD, Lifecycle & Creation UI

Status: done

<!-- FIRST story of Epic 3. On pickup, sprint-status flips `epic-3 → in-progress`. Builds directly on the DELIBERATELY PARTIAL `classes` table shipped by Story 2.2 spawn ("Story 3.1 owns the full class lifecycle; this migration ships only what spawn needs"). Ships FR-12 (class creation), FR-14 (lifecycle). Depends on Story 2.6 (role ladder, `useRole()`, `RouteRoleGate`, `TenantContext.Role` DB-authoritative). -->
<!-- SCOPING DECISIONS (Ducdo, 2026-07-18):
  • AC2 "toggleable template sections" = SCALAR-field prefill with per-field include/exclude Switch + READ-ONLY session-plan preview. NO class_sessions materialization (no table until Story 3.4); document/exercise toggles are N/A until Epic 4. AC2 amended accordingly.
  • Schema = ADD `description, capacity, due_dates_enabled, updated_at, end_date, color`. NO `schedule_pattern` — structured scheduling is Story 3.4. s07 "Schedule" column shows `start_date`; "Students"/"Sessions" columns render deferred placeholders (data lands in 3.2/3.4).
  • Lifecycle transition set = the epic AC arrow set EXACTLY (upcoming→active, active→{paused,ended}, paused→active). Paused→Ended is NOT allowed (resume then end) — epic AC "no other transitions allowed" is authoritative over FR-14's looser narrative. See Dev Notes → Open Questions. -->
<!-- Enrollment dependency note: this story gives a real class list (helps unblock Story 2.7 class-name matching) but does NOT create the `enrollments` table — that is Story 3.2 (Students tab) / Epic 7 (7.3). See deferred-work.md → "Story 2.7 … re-sequenced behind Story 3.1" (SEQ-2-7-1). -->
<!-- NO hard-delete endpoint (architecture §"Audit & immutability" mandates soft-delete; ACs cover only create/edit/lifecycle). NO class detail/tabs (3.2), NO student roster (3.2), NO sessions/schedule (3.4), NO templates-management CRUD (3.3), NO analytics (Epic 8), NO plan-limit capacity enforcement (Epic 9), NO auto-archive (forward/config). -->

## Story

As a **Teacher, Admin, or Owner**,
I want to **create, edit, and manage classes with enforced lifecycle transitions, and see a `/classes` index scoped to my role**,
so that **I can organize teaching around structured class entities that reflect real-world progression, without a teacher seeing or touching another teacher's classes**.

## Response Envelope Contract

Inherits shipped envelopes (`WriteEnvelope`/`WriteError`, `internal/handler/response.go`). Mirror the **room CRUD** wire shapes (`api.yaml` `Room`/`CreateRoomRequest`/`UpdateRoomRequest`/`EnvelopeRoom`/`EnvelopeRoomList`, lines ~2822-2936). New schemas + error codes:

**New api.yaml schemas:** `Class`, `ClassStatus` (enum `upcoming|active|paused|ended`), `CreateClassRequest`, `UpdateClassRequest`, `ClassStatusTransitionRequest`, `EnvelopeClass`, `EnvelopeClassList`.

`Class` (required, all fields explicit incl. nulls per GO-5 — NO `omitempty`): `id, centerId, templateId(null), name, description(null), targetBand(null), primarySkill(null), sessionCount(null), capacity(null), status, teacherId(null), pendingTeacherEmail(null), startDate(null), endDate(null), color(null), dueDatesEnabled, createdAt, updatedAt`.

| Code | HTTP | When |
|---|---|---|
| `CLASS_NOT_FOUND` | 404 | `GET/PATCH/POST-status` on an id invisible under RLS/teacher-scope or absent (`pgx.ErrNoRows`). Includes a Teacher targeting a class not assigned to them — the teacher-scoped query returns 0 rows, so cross-teacher access is **404, not 403** (see AC6). |
| `INVALID_STATUS_TRANSITION` | 422 | Requested `status` is not reachable from the current status per the transition map (AC4). `details: [{ field: "status", code: "INVALID_STATUS_TRANSITION" }]`, message names current + target. |
| `FORBIDDEN` (`INSUFFICIENT_ROLE`) | 403 | Reserved for the `classChain` role-gate (verified/member checks). Cross-teacher class access is **404, not 403** (see AC6) — the `*service.ForbiddenError` → 403 mapping is not the cross-teacher path here. |
| (validation) | 422 | `CreateClassRequest`/`UpdateClassRequest` field violations (name length, capacity range, invalid `primarySkill`, malformed dates) via `model.ValidationError{Fields}`. |

## Acceptance Criteria

1. **Create → `Upcoming`.** `POST /api/classes` with a valid `CreateClassRequest` creates a class with `status = 'upcoming'` (server-forced; client cannot set status on create) and returns `201` + `EnvelopeClass`. `dueDatesEnabled` defaults `false` (AC3). A `class.created` audit row is written in-tx via `s.audit.LogWithinTx(ctx, tx, tc, "class.created", "class", classID, Changes{Before:nil, After:{...}})`. Allowed roles: **owner, admin, teacher** (via `classChain`, NOT owner-gated). When a Teacher creates a class, `teacher_id` defaults to the caller unless an explicit teacher/`pendingTeacherEmail` is provided; the `classes_teacher_mutex` CHECK (teacher_id XOR pending_teacher_email) must hold. When an Owner/Admin creates a class, `teacher_id`/`pendingTeacherEmail` is REQUIRED in the request (no caller default) — an owner does not auto-assign themselves; the mutex forbids a fully unassigned class. `capacity`, when provided, must satisfy `capacity > 0` (DB `CHECK`); `capacity` is nullable at create and cannot be cleared back to NULL via `PATCH` in this story (COALESCE keeps it — see AC6).

2. **Template prefill with per-field toggles (scalar) + read-only session preview.** When the creation form is opened with a selected template (`GET /api/templates` via reused `useListTemplates`), the scalar fields (`name` suggestion, `targetBand`, `primarySkill`, `sessionCount`, `color`) are pre-filled, **each behind an include/exclude `Switch`**. **Wire contract: the per-field toggle applies to CREATE only. An excluded field is OMITTED from `CreateClassRequest` (key absent), so the new row's column is `NULL`/DB-default — the template value is never copied. `CreateClassRequest` fields are all optional; absent = unset.** (Edit-mode reuses the same dialog but the template toggle wall is not shown — see AC6 for `PATCH` semantics.) The template's session plan (`ListTemplateSessionsByTemplateID`) renders as a **read-only preview list** (title + optional description, ordered). `templateId` is persisted on the created class (`template_id` FK, `ON DELETE SET NULL`). **No class-session rows are materialized** (deferred to Story 3.4); **document/exercise toggles are out of scope** (Epic 4). [AC2 amended per 2026-07-18 scoping — see header.]

3. **Due dates OFF by default.** New column `classes.due_dates_enabled boolean NOT NULL DEFAULT false`. A freshly created class (from scratch OR from template) has `dueDatesEnabled = false`; enabling is an explicit `PATCH` (`UpdateClassRequest.dueDatesEnabled = true`). Assert the DB default is `false` in a store test (not just the service).

4. **Enforced lifecycle transitions.** `POST /api/classes/{id}/status` with `{ status }` validates the transition against a Go allowed-transition map **before** issuing `UpdateClassStatus`. Legal set (exactly — "no other transitions allowed"):
   ```
   upcoming → active
   active   → paused | ended
   paused   → active
   ended    → (terminal, no transitions)
   ```
   Any other move (e.g. `upcoming→ended`, `paused→ended`, `ended→active`, same-state no-op) returns `422 INVALID_STATUS_TRANSITION`, and writes NO audit row (a rejected transition must not emit `class.status_changed`). A legal transition writes a `class.status_changed` audit row (`Before:{status:old}, After:{status:new}`) and returns `200` + `EnvelopeClass` with `updatedAt` advanced.

   **Concurrency (compare-and-swap, MANDATORY):** the map check must not be a bare read-then-write. `UpdateClassStatus` issues `UPDATE ... SET status=$new, updated_at=now() WHERE id=$1 AND status=$expected RETURNING ...`; a `0`-row result means the row moved under a concurrent transition → return `INVALID_STATUS_TRANSITION` (re-fetch to report actual current state). Equivalent: `SELECT ... FOR UPDATE` the row inside the same tx before validating. Two racing legal moves from the same state MUST NOT both commit. The transition map lives in one place (new `internal/service/class_lifecycle.go` or a `var classTransitions = map[string][]string{...}` in `class.go`) — this is the FIRST state machine in the codebase; no precedent to copy.

5. **Role-scoped `/classes` index (server-enforced).** `GET /api/classes` returns classes scoped by the caller's **DB-authoritative** `TenantContext.Role`:
   - `owner`/`admin` → **all** center classes (`ListClasses`, RLS tenant-scoped).
   - `teacher` → **only** classes where `teacher_id = callerUserID` (`ListClassesByTeacher`, still inside a `SetTenantContext` tx so RLS is belt-and-suspenders).
   RLS enforces tenant only — **the role branch is in the handler/service, never RLS** (SEC-1, PERF-2). Frontend `/classes` route is gated by `RouteRoleGate allowedRoles={['owner','admin','teacher']}`; the page renders a role-appropriate heading/scope label. **Negative assertion required**: a Teacher's response MUST NOT contain another teacher's class (assert absence, TEST-BE + TEST-FE-6).

6. **Edit + mutation authorization.** `PATCH /api/classes/{id}` (partial update: `name, description, targetBand, primarySkill, sessionCount, capacity, startDate, endDate, color, dueDatesEnabled, teacherId|pendingTeacherEmail`) updates the class, sets `updated_at = now()`, writes a `class.updated` audit row (`Before`/`After` diff), returns `200` + `EnvelopeClass`. Authz: `owner`/`admin` may edit/transition **any** class in the center; `teacher` may edit/transition **only** a class assigned to them (`teacher_id = caller`). A `teacher`'s read/write is teacher-scoped, so a class not assigned to them is invisible under the scoped query and returns `404 CLASS_NOT_FOUND` — NOT `403` (teacher-sees-nothing: a teacher cannot distinguish "another teacher's class" from "does not exist"; intended security posture; there is no cross-teacher `403` within a center for these endpoints). `PATCH` is set-only in 3.1: absent field = unchanged (`COALESCE(narg, existing)`); nullable fields (`capacity`, `description`, `color`, `targetBand`, `endDate`, …) CANNOT be cleared to NULL via `PATCH` this story — send a new value or leave absent. Clearing support is out of scope (forward). `GET /api/classes/{id}` returns a single class (`CLASS_NOT_FOUND` if invisible/absent) for edit-form prefill.

7. **`/classes` index UI (screen s07).** The index renders as the UX-spec list-table (§6.5/§8.3): page-head with count → status tabs (`upcoming|active|paused|ended` with mono counts) → `table.grid`. Columns: **Class** (colored skill/letter tile + name + mono meta) · **Skill** · **Schedule** (`startDate` formatted via i18n; structured schedule is Story 3.4) · **Students** (deferred — render as a visibly *dormant* cell: muted/low-contrast with a "coming soon" affordance, NOT a bare "—" which reads as a load failure; data lands 3.2) · **Sessions** (deferred, same dormant treatment; data lands 3.4) · **Status** (`ClassStatusPill`) · **Target band** (`BandPill`) · **Actions**. Status-pill colors per UX §5.6: Upcoming→blue (`--cl-tint-blue`/`--cl-accent`), Active→green, Paused→amber (`--cl-tint-gold`/`--cl-amber`), Ended→red (`--cl-tint-red`/`--cl-red`). Ended/upcoming rows dimmed 0.7 (per the shared list-table pattern, UX §5.6 / §6.5 line 396 — applies across `s07`/`s10a`/`s15`/`s39`/`s42`/`s70`; do NOT special-case s07). **Row click is inert this story → OMIT the affordance entirely: no `cursor:pointer`, no hover-elevation, no click handler. Interactivity attaches only to real targets (status pill per AC8, Actions menu); the class name becomes a link in Story 3.2 when its destination exists.** **Loading/Empty/Error trilogy mandatory** (UX-1): skeleton rows (not spinner) / `s54` empty-state (Fraunces headline "No classes *yet*" + create CTA) / inline `role="alert"` retry — reuse the `RoomsTab` trilogy helpers. **The `s54` create-CTA hero is scoped to the truly-zero-classes case; a status tab filtered to zero rows shows a quiet inline "Nothing {status} right now", NOT the hero (which would misreport an empty center).**

8. **Create/Edit form + status control (UI).** Creation/edit uses a `<Dialog>` (RoomsTab precedent) OR a `/classes/new` lazy child route (dev choice — document; either must be its own chunk). Form = RHF + `zodResolver` with a new `classSchema` (lift field validators from onboarding `classSpawnSchema.ts` — `name` trim+rune-count 1..120, `startDate` ISO + range, teacher-email via `AssignChip`/`AssignTeacherComposer`). Template picker reuses `TemplateSelectPage`/`useListTemplates` patterns. **Status transitions are surfaced by making `ClassStatusPill` itself the trigger** (pill + subtle caret + hover/focus affordance) → `DropdownMenu` offering **only legal** next states (map mirrored client-side; server is source of truth). **The current state is ABSENT from the menu (not disabled-and-listed) — so the AC4 same-state `active→active` 422 is unreachable from the UI.** Lifecycle does NOT live in the row's kebab/Actions menu (Edit only). **Optimistic update with rollback (FW-2 triple): on server reject the pill snaps back to the LITERAL prior status/color and the error surfaces via an inline `role="alert"` adjacent to the row — not a floating toast.** "Due dates" + per-template-field toggles use the `switch.tsx` primitive.

9. **i18n (both locales).** New flat `classes.*` keys authored in `en.json` AND `vi.json` at parity (UX-2), added to a new `STORY_3_1_KEYS` array in `src/lib/test/__tests__/i18n-parity-coverage.test.ts` (else `i18n-parity` CI fails). `PermissionDenied` gains a `classes` `SectionNameKey`. Assert key existence in both locales (TEST-FE-4).

## Tasks / Subtasks

- [x] **Task 0 — ATDD gate (AC4, AC5).** ✅ Red-phase landed via `/bmad-tea AT 3-1` (2026-07-19). Service-level AC4 matrix + CAS concurrency + audit-not-written and AC5 role-scoped `List`/`ListForTeacher` in `class_lifecycle_atdd_test.go` (compile-red on the 3 missing methods); AC5 frontend TEST-FE-6 absence in `ClassesPage.test.tsx` (import-red). Checklist: `_bmad-output/test-artifacts/atdd-checklist-3-1-class-crud-lifecycle-and-creation-ui.md`. Consult `_bmad-output/test-artifacts/test-design/classlite_new-handoff.md` + `test-design-architecture.md` risk register for Epic 3 / Story 3.1. **AC4 (transition enforcement — FIRST state machine in the codebase, no precedent) and AC5 (teacher-scope isolation — cross-teacher data boundary) are UNCONDITIONALLY mandatory** `/bmad-tea AT` RED-phase before `in-progress` (WF-8): novelty and authz-boundary blast radius are ≥6 by construction. The "if score ≥6 in the register" clause applies only to the remaining ACs (AC1–AC3), skippable at engineer discretion.

- [x] **Task 1 — Schema migration (AC1, AC3, AC6).** New pair `{YYYYMMDDHHMMSS}_add_class_crud_columns.{up,down}.sql`. `up`: `ALTER TABLE classes ADD COLUMN description text, ADD COLUMN capacity integer, ADD COLUMN due_dates_enabled boolean NOT NULL DEFAULT false, ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now(), ADD COLUMN end_date date, ADD COLUMN color text, ADD CONSTRAINT classes_capacity_positive CHECK (capacity IS NULL OR capacity > 0);` **(CHECK is REQUIRED, not optional.)** **`updated_at` DEFAULT fires on INSERT only — every `UpdateClass`/`UpdateClassStatus` query MUST `SET updated_at = now()` explicitly in the query body (no trigger — keeps it greppable). `end_date` carries NO cross-field validation in 3.1 (may precede start; independent of `due_dates_enabled`) — deliberate.** `down`: `DROP CONSTRAINT classes_capacity_positive`, then `DROP COLUMN` each (reverse order). Run `scripts/migrate.sh`. **Never edit the 2.2 create_classes migration** (WF-2).
  - [x] Verify RLS policies/indexes unaffected (columns only).

- [x] **Task 2 — sqlc queries (AC1, AC3, AC4, AC5, AC6).** Edit `internal/store/queries/classes.sql`:
  - [x] Extend `CreateClass` to insert the new columns (`description, capacity, due_dates_enabled, end_date, color`). **REGRESSION-CRITICAL:** `CreateClass` is called by shipped `ClassService.Spawn` (`class.go:~387`) — update that callsite to pass `description:nil, capacity:nil, due_dates_enabled:false, end_date:nil, color:<tmpl.Color>`; the Spawn ATDD suite (`class_atdd_test.go`) MUST stay green. **Sequence the codegen: CHUNK 1 = `CreateClass` extension + Spawn callsite + `codegen.sh` + green `class_atdd_test.go`, verified BEFORE the new queries; the new queries below get a SEPARATE `codegen.sh` run (a single mega-codegen widens blast radius onto Spawn). Before finishing Task 2, grep every reader of the `classes` row/model — sqlc regenerates all row structs with the 6 new columns; any `SELECT *`/hand-scan shipped by 2.2 must be reconciled.**
  - [x] Add `ListClasses :many` (RLS-scoped, ordered by status-priority then `created_at DESC` or `name`).
  - [x] Add `ListClassesByTeacher :many` (`WHERE teacher_id = $1`).
  - [x] Add `UpdateClass :one` (partial-update via `sqlc.narg`/COALESCE per room `UpdateRoom` precedent; `updated_at = now()`; RETURNING all cols).
  - [x] Add `UpdateClassStatus :one` (`SET status = $2, updated_at = now() ... RETURNING`).
  - [x] Run `scripts/codegen.sh` (WF-3 — last script after any `.sql` touch).

- [x] **Task 3 — api.yaml + regenerate (AC1, AC4, AC5, AC6).** Add schemas + paths (mirror rooms): `GET/POST /api/classes`, `GET/PATCH /api/classes/{id}`, `POST /api/classes/{id}/status`. Register error codes `CLASS_NOT_FOUND`, `INVALID_STATUS_TRANSITION` in `internal/handler/errors.go`. Run `scripts/codegen.sh` (regenerates Go types + `src/lib/api/client.ts` + Zod). **WF-1 order: api.yaml → codegen → backend → frontend. WF-4: this is additive (new endpoints) — may ship API-first, but keep the full-stack change in one PR.** _[Deviation: no central `errors.go` enum exists — codes are carried in typed errors (`model.NotFoundError{Code}` / `model.ValidationError.Fields[].Code`) mapped by `middleware.ErrorMapper`, per the shipped room/term precedent. Codes emitted in Task 4/5. Codegen runs sqlc + openapi-typescript only; Go request/response structs are hand-written in handlers.]_

- [x] **Task 4 — ClassService (AC1, AC4, AC5, AC6).** In `internal/service/class.go` (+ new `class_lifecycle.go` for the transition map): add `Create`, `List`, `ListForTeacher`, `Update`, `TransitionStatus` methods. _[CRUD methods placed in new `class_crud.go` (same package) to keep the ~850-line `class.go` focused on Spawn — placement is behavior-neutral. Cross-teacher authz returns **404 CLASS_NOT_FOUND** (AC6 party-mode decision), not `*service.ForbiddenError` (Task 4's stale parenthetical). ATDD `class_lifecycle_atdd_test.go` GREEN (AC4 legal/illegal/CAS-race/audit-not-written + AC5 role-scoped); Spawn regression green. Fixed a red-phase test bug: `seedClassRaw` inserted via the non-superuser pool (FORCE RLS → 42501) and `List` test cleanup FK-leaked teacher members — both repaired.]_ Reuse Spawn's tx ceremony: `Begin` → `store.SetTenantContext(ctx, tx, tc)` → `generated.New(tx)` → mutate → `LogWithinTx` audit → `Commit`. `TransitionStatus` validates against `classTransitions` map, returns `model.ValidationError`/`INVALID_STATUS_TRANSITION` on illegal moves. `Update`/`TransitionStatus` enforce the AC6 teacher-owns-class authz (return `*service.ForbiddenError`). No new constructor deps.

- [x] **Task 5 — ClassHandler + wiring (AC1, AC5, AC6, AC7).** New `internal/handler/class_handler.go` (methods on a typed struct, GFW-1). `List` reads `tc.Role` and branches owner/admin vs teacher (pass `userIDFromContext(r)`). Decode bodies with `DisallowUnknownFields()`. Wire in `cmd/api/main.go` a new **`classChain`** = `extractTenant → requireVerified → requireCenter → ErrorMapper` (NO `requireOwner` — teachers must reach it). Register the 5 routes (Go 1.22 method patterns + `{id}`). All responses via `WriteEnvelope`/`WriteError`. _[Handler ATDD (`class_handler_atdd_test.go`, TEST-BE-3 real middleware) + test-server helper (`story_3_1_helpers.go` `NewClassTestServerBareMux` + `SeedClass`) GREEN: create→upcoming envelope, owner-must-assign-teacher 422, teacher-defaults-self, role-scoped list (leak assertion), 404 unknown, teacher-on-others-class 404, legal/illegal(422 INVALID_STATUS_TRANSITION)/garbage(422 INVALID_STATUS), 401. `classSvc` reused from existing main.go instantiation. Non-{owner,admin,teacher} role → 403.]_

- [x] **Task 6 — Frontend feature `src/features/classes/` (AC5, AC7, AC8, AC9).**
  - [x] `api/classesKeys.ts` (factory: `all, list(centerId, scope), detail(id), createMutation, transitionMutation`). **`scope` (`'all'` for owner/admin vs `'teacher:<userId>'`) is part of the list key — owner and teacher lists are DIFFERENT cache entries; `useTransitionClassStatus`/`useUpdateClass` optimistic patches MUST update every cached `list(...)` scope a class appears in (the `useMutateRoom` triple is single-audience — extend it).**
  - [x] `api/useClasses.ts`, `useCreateClass.ts`, `useUpdateClass.ts`, `useTransitionClassStatus.ts` (copy `useRooms`/`useMutateRoom` shape incl. FW-2 optimistic triple; all via `apiFetch`). _[`useTransitionClassStatus` patches EVERY cached `list(...)` scope + rolls each back to its literal snapshot. Center/user read from the module-singleton session (matching `useRole`) so component tests seeding the singleton resolve center — `useCurrentCenter`/`useAuth` read the provider client which diverges only under test.]_
  - [x] `lib/classSchema.ts` (**COPY** field validators from `onboarding/lib/classSpawnSchema.ts` — single-class, no array wrapper; Zod messages as i18n keys). _[Duplication tracked as FU-3-1 (extract shared validators). `.email()` deprecated in this Zod → regex refine.]_
  - [x] `ClassesPage.tsx` (s07 index: status tabs + list-table + trilogy; role-branched scope label via `useRole()`). _[Default tab lands on first non-empty status; row click inert (no pointer affordance); dormant Students/Sessions cells with "coming soon"; dimmed upcoming/ended rows; s54 empty-hero only for truly-zero, quiet per-tab empty otherwise.]_
  - [x] `components/ClassStatusPill.tsx` (semantic-token colors per UX §5.6 — pill IS the transition trigger, only legal next states, current absent), `ClassFormDialog.tsx` (create/edit + template picker + per-field toggles + create-omit wire contract + due-dates Switch). _[AC2 session preview = `sessionCount` summary (no template-detail endpoint exists to fetch per-session rows → **FU-3-1-A**). Teacher assign = pending-email input (full AssignChip/AssignTeacherComposer reuse → **FU-3-1-B**). No BandPill component exists → targetBand rendered as text.]_
  - [x] Barrel `index.ts` (onboarding-style). `CLIENT_TRANSITIONS` in `lib/classTransitions.ts` (fast-refresh: component files export only components).

- [x] **Task 7 — Routing + nav (AC5, AC7).** Mount `/classes` in `src/routes.tsx` under the AppLayout group as its own lazy chunk, wrapped in `RouteRoleGate allowedRoles={['owner','admin','teacher']} requiredRolesForCopy={['owner','admin']} sectionNameKey="classes"`. Add `classes` to `PermissionDenied` `SectionNameKey` union. Sidebar entries already stubbed — no change needed. Extend `e2e/route-bundle-boundaries.spec.ts` with a `/classes` cross-chunk assertion. **Form-factor decision: DIALOG** (ClassFormDialog is a `<Dialog>`) — no `/classes/new` route, single bundle boundary. _[Deep-imported `ClassesPage.tsx` (not the barrel) so Rolldown emits a dedicated 22 kB `ClassesPage-*.js` chunk; bundle test GREEN (`classes-page` testid present, absent from onboarding/dashboard/settings chunks). `requiredRolesForCopy` uses the `['owner','admin']` tuple (PermissionDeniedRoles supports only owner/admin variants; teacher is in `allowedRoles`).]_

- [x] **Task 8 — i18n (AC9).** Author `classes.*` keys in `en.json` + `vi.json` (parity); mirror `settings.rooms.*` / `onboarding.spawn.*` structure (`.sectionHeading, .createCta, .statusTabs.*, .table.columns.*, .status.{upcoming,active,paused,ended}, .form.*, .transition.errors.invalidTransition, .empty.{headline,body,cta}, .error.*`). Add `STORY_3_1_KEYS` coverage array. Add `app.permissionDenied.section.classes.*`. _[66 keys en+vi at parity; interpolation-token parity + prefix ratchet green; `npm run i18n-parity` OK at 787 keys.]_

- [x] **Task 9 — Tests (all ACs).** See Testing section. Backend: extend `classes_rls_test.go` for UPDATE/status surface; store integration (List/ByTeacher/Update/UpdateStatus + due-dates default); service transition matrix (mock store seam, TEST-BE-4); handler ATDD (real middleware, TEST-BE-3) incl. teacher-scope negative + illegal-transition 422 + teacher-edits-others 403. Frontend: `ClassesPage` trilogy + role-based rendering (TEST-FE-6 absence assertion) + create/edit dialog + status optimistic + i18n key existence + axe. Add `fixtures.CreateClass`/`SeedClass` helper. _[DELIVERED: service ATDD (AC4 legal/illegal/CAS/audit-not-written + AC5 role-scope), handler ATDD (AC1 create/upcoming/envelope + owner-must-assign 422 + teacher-defaults-self + role-scope list + GET 404 + **teacher-on-others 404 not 403** + garbage-status INVALID_STATUS 422 + 401), store integration (AC3 due_dates DB-default false + cross-tenant UpdateClass RLS), `SeedClass` fixture. Frontend: ClassesPage trilogy + TEST-FE-6 absence + axe, useTransitionClassStatus optimistic settle/rollback/multi-scope, ClassStatusPill legal-states, ClassFormDialog template-toggle + **AC2 create-omit wire contract**, i18n parity. **Deviations:** service "mock store seam TEST-BE-4" → real-DB ATDD (shipped ClassService takes AuthDB not a store interface — same as class_atdd_test.go); "teacher-edits-others 403" → **404** (AC6 party-mode authoritative); ClassStatusPill onSelect-invoke not unit-driven (jsdom can't fire Radix onSelect — covered by hook + handler tests). Full regression green (1 pre-existing FU-2-5b-A RoomsTab flake, unrelated).]_

## Dev Notes

**Reuse map (do NOT reinvent):**

| Need | Reuse | Path |
|---|---|---|
| Tx + audit ceremony | `ClassService.Spawn` | `internal/service/class.go:181` (Begin → `store.SetTenantContext` → `generated.New(tx)` → `LogWithinTx` → Commit) |
| Audit call | `s.audit.LogWithinTx(ctx, tx, tc, action, "class", id, Changes{Before, After})` | actions: `class.created` / `class.updated` / `class.status_changed` |
| Full-CRUD handler/route/api.yaml/envelope template | **rooms** | `internal/handler/room_handler.go`, `cmd/api/main.go:375-386`, `api.yaml` rooms block, `queries/rooms.sql` `UpdateRoom` (partial-update precedent) |
| Caller role (DB-authoritative) | `model.TenantContext.Role` | set by `middleware.ExtractTenant` (`internal/middleware/auth.go:101-108`) from live `center_members` |
| Caller user id in handler | `userIDFromContext(r)` | `internal/handler/onboarding_handler.go:162` |
| teacher_id filter index | `idx_classes_teacher_id` (partial) | already exists |
| RLS test grid (6 patterns + reparent + mutex) | `classes_rls_test.go` | extend for UPDATE/status |
| Template read (prefill + preview) | `ListAccessibleTemplates`, `ListTemplateSessionsByTemplateID` | `queries/class_templates.sql` |
| FE mutation optimistic triple | `useMutateRoom` | `src/features/settings/api/useRooms.ts:35-72` |
| FE trilogy (skeleton/empty/error/Dialog/AlertDialog) | `RoomsTab.tsx` | `src/features/settings/RoomsTab.tsx:77-118, 376-537` |
| FE create-form validators | `useClassSpawnSchema()` | `src/features/onboarding/lib/classSpawnSchema.ts` (lift field rules; drop the array/templateId wrapper) |
| FE template picker + teacher assign | `TemplateSelectPage`, `AssignChip`, `AssignTeacherComposer`, `useListTemplates` | `src/features/onboarding/*` + `src/components/domain/AssignChip.tsx` |
| FE role hooks + gate | `useRole()` / `useRoleLoading()` / `RouteRoleGate` | `src/hooks/useRole.ts`, `src/components/shared/RouteRoleGate.tsx` (Story 2.6) |
| Status-pill token pattern | per-instance `bg-[color:var(--cl-tint-*)] text-[color:var(--cl-*)]` | `src/components/domain/CommentCard.tsx:48,53` |

**Critical constraints:**
- **RLS is tenant-only** — teacher-vs-admin scoping is service-layer (SEC-1, PERF-2). Never `DISABLE ROW LEVEL SECURITY`; use deterministic test tenant IDs.
- **GO-1 / PERF-1:** every store call carries `TenantContext` and runs inside a tx with `SET LOCAL app.current_tenant_id` — even reads (List/Get).
- **GO-5:** no `omitempty` on `Class` JSON tags — explicit nulls (frontend contract).
- **CQ-3:** transition map + status constants are named, not inlined; `classes_teacher_mutex` (teacher_id XOR pending_teacher_email) must always hold.
- **WF-3 heuristic:** touched a `.sql` file → `codegen.sh` is the last script before "done".

**Open Questions (defaulted pragmatically; flag at code review if product disagrees):**
1. **Paused→Ended** is disallowed (resume→end). **CLOSED 2026-07-19 (Ducdo): keep disallowed — epic-AC exact arrow set is authoritative; terminal path is `paused→active→ended`.** No map change.
2. **Row click on s07** is inert until Story 3.2 ships the detail route — wire a no-op (cursor default) or omit the click affordance; documented either way.
3. **Class deletion** intentionally absent (soft-delete + immutability, architecture §"Audit & immutability"). Ended is terminal. If a delete/archive affordance is needed, it's a separate story.

### References

- [Source: _bmad-output/planning-artifacts/epics/epic-03.md#Story-3.1] — ACs, deps, size.
- [Source: _bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-12] — creation fields (name, description, teacher, target band, schedule pattern, capacity), template prefill "each toggleable", due dates off by default.
- [Source: .../prd.md#FR-14] — lifecycle Upcoming→Active→Paused→Ended; paused stops reminders; ended→archive after 30 days (forward).
- [Source: classlite-api/migrations/20260703120200_create_classes.up.sql] — base schema, `status` CHECK, `classes_teacher_mutex`, 4 RLS policies (tenant-only), `idx_classes_teacher_id`.
- [Source: classlite-api/internal/service/class.go:181] — Spawn tx/audit pattern; `CreateClass` callsite (regression).
- [Source: classlite-api/internal/store/queries/classes.sql] — existing `CreateClass`/`GetClassByID`.
- [Source: _bmad-output/planning-artifacts/ux-design-specification.md] — §8.3 s07 columns; §6.5 list-table; §5.6 status colors; §6.4 trilogy; §5.4 pill/switch.
- [Source: _bmad-output/implementation-artifacts/deferred-work.md] — SEQ-2-7-1 (enrollment dependency for downstream 2.7).
- [Source: docs/project-context.md] — GO-1..7, SEC-1, PERF-1/2, GFW-1..7, FW-2, UX-1/2, TEST-BE-1..4, TEST-FE-1..6, WF-1..8, CQ-1..5.

## Testing

**Backend (per test architecture — real DB in tx, store interface is the only service seam):**
- Extend `classes_rls_test.go`: cross-tenant UPDATE + status-transition isolation (write-isolation, 0-rows-is-not-an-error), reparent WITH CHECK, teacher_mutex on update.
- Store integration (`test.SetupDB`): `ListClasses` returns center rows; `ListClassesByTeacher` returns only matching `teacher_id`; `UpdateClass` partial-update; `UpdateClassStatus`; **`due_dates_enabled` DB default is `false`** (AC3).
- Service (mock store, TEST-BE-4): `TransitionStatus` full matrix — every legal move succeeds + writes audit; every illegal move (`upcoming→ended`, `active→active`, `paused→ended`, `ended→*`) returns `INVALID_STATUS_TRANSITION`; teacher-edits-unassigned → `ForbiddenError`.
- Handler ATDD (real middleware, TEST-BE-3): create→`upcoming` + full envelope; List as owner (all) vs teacher (**own only — assert another teacher's class ABSENT**); PATCH by owner (any) vs teacher own (ok) vs teacher other (403); status POST legal (200) + illegal (422 shape incl. `requestId`). For every positive assertion, a negative counterpart.
- Add `fixtures.CreateClass(t, db, centerID, opts)` / `SeedClass`.

**Frontend (MSW at HTTP boundary — never mock useQuery; `retry:false`):**
- `ClassesPage`: three-state (skeleton / `s54` empty / `role="alert"` error) named tests (TEST-FE-2); role-based rendering — owner/admin see center scope, teacher sees own-scope label AND another teacher's class is **absent from DOM** (TEST-FE-6, MSW returns teacher-scoped payload).
- Create/edit `ClassFormDialog`: RHF+Zod inline errors; template select → scalar prefill + per-field toggle excludes field; due-dates Switch defaults off; 422 server field-map surfaces inline.
- Status control: only legal next states offered; optimistic transition + rollback on error (FW-2); illegal move never reaches server (affordance) but server 422 handled if forced.
- i18n: assert `classes.*` keys exist in `en` AND `vi` (TEST-FE-4); parity coverage array present.
- axe: **full pass on the index only; the dialog gets a focus-trap/label smoke check, not a second full axe** (TEST-FE-5). Reset any Zustand via `reset()` in `beforeEach` (TEST-FE-3) — none expected (server state only).

**Party-mode risk additions (Murat, 2026-07-19):**
- **Store — concurrency (highest-regret):** two concurrent `UpdateClassStatus` from the same state → exactly one commits (compare-and-swap, AC4).
- **Service — audit-not-written:** every illegal transition asserts audit-row-count UNCHANGED, not just the error code.
- **Handler — garbage status:** `status:"deleted"`/wrong-case/`""`/null → validation-422 at the boundary (distinct shape from `INVALID_STATUS_TRANSITION`), never reaches the store.
- **Write-scope isolation:** teacher `PATCH`/status on a class not theirs → **404** (AC6) at handler; RLS `WITH CHECK` blocks the write on the 0-rows path; reparent to a non-member center rejected.
- **Mutex on update:** setting `teacher_id` clears `pendingTeacherEmail` and vice versa; teacher-edits-invited-but-unassigned (email == `pendingTeacherEmail`, `teacher_id` null) → 404 per AC6.
- **Store — `updated_at` monotonicity:** advances on update, `created_at` untouched.
- **Migration down-path:** up→down→up idempotent; down drops the 6 columns + CHECK cleanly.
- **FE optimistic rollback — 3 named tests:** apply→200 settles · apply→422 rolls back to the SPECIFIC prior status + `role="alert"` · illegal blocked client-side but 422 handled if forced.
- **Audit assertions are content** (actor_id, from_status, to_status, class_id), not existence.

**Cut as over-testing:** don't re-assert the full envelope shape on all 6 legal transitions (shape once at create→upcoming, status-code + error-shape for the rest); i18n keep en+vi key-existence but do NOT assert rendered Vietnamese strings; `due_dates_enabled` — keep the store DB-default + FE Switch-off, cut the redundant service-layer re-assertion.

## Definition of Done

- [x] All 9 ACs met; `tsc --noEmit` (app+e2e), `eslint`, `go test ./...`, `vitest`, `i18n-parity` all green. _(golangci-lint not installed locally → `go vet` + `gofmt` clean instead.)_
- [x] Migration up+down verified (`migrate.sh` up then down then up); `codegen.sh` run (2 split runs); generated files regenerated, none hand-edited (XL-1).
- [x] Spawn regression: `class_atdd_test.go` still green after `CreateClass` signature change.
- [x] RLS grid extended + passing; teacher-scope negative + illegal-transition + teacher-edit-**404** (AC6 party-mode authoritative, not 403) covered.
- [x] Trilogy on `/classes`; both locales at parity; axe clean; `route-bundle-boundaries` extended + green.
- [ ] Atomic full-stack commit (api.yaml + generated + backend + frontend, WF-4). _(Left uncommitted for `/bmad-code-review` per project flow; baseline `dfa65f0`.)_
- [x] Story file ≤600 lines (convention); Dev Agent Record + File List in `3-1-...-completion-notes.md`.

## Out of Scope

Class detail view / tabs (Story 3.2) · student roster + `enrollments` table (Story 3.2 / Epic 7 — see deferred-work SEQ-2-7-1) · sessions, schedule workspace, recurrence, `schedule_pattern` (Story 3.4) · class-session materialization from template (Story 3.4) · templates-management CRUD + reorder (Story 3.3) · analytics (Epic 8) · plan-limit capacity enforcement (Epic 9) · auto-archive 30 days after end (forward/config) · class hard-delete / soft-delete affordance · document/exercise template toggles (Epic 4) · student `/my-classes` route · class color-coded schedule blocks (Story 3.4).

## Change Log

| Date | Change |
|---|---|
| 2026-07-19 | Story created (ready-for-dev). Exhaustive scoping: 2 decisions taken with Ducdo (AC2 scalar-prefill + read-only session preview; core columns, defer scheduling to 3.4). Lifecycle transition set fixed to epic-AC arrows (paused→ended disallowed). First Epic-3 story → epic-3 flips in-progress. |
| 2026-07-20 | **Green-phase shipped `in-progress → review`** via `/bmad-dev-story 3-1`. All 9 ACs green, all 9 tasks + subtasks checked. Backend: migration (6 cols + capacity CHECK, up→down→up verified) + sqlc (split codegen, CreateClass/GetClassByID full-row + List/ListByTeacher/UpdateClass[COALESCE+mutex CASE]/UpdateClassStatus[CAS]) + api.yaml (Class/CreateClassRequest/UpdateClassRequest/ClassStatusTransitionRequest/EnvelopeClass[+List] + 5 paths) + ClassService (`class_lifecycle.go` transition map + CAS TransitionStatus; `class_crud.go` Create/List/ListForTeacher/Get/Update + validation + audit) + ClassHandler (role-branched List, strict decode, garbage-status→INVALID_STATUS 422) + `classChain` wiring. Frontend: `src/features/classes/` (scoped-key hooks + FW-2 multi-scope optimistic transition, classSchema, ClassesPage s07 index, ClassStatusPill, ClassFormDialog) + `/classes` lazy route (own 22 kB chunk) + 66 i18n keys en+vi + STORY_3_1_KEYS + bundle-boundary assertion. **Regression:** `go test ./...` 11/11 pkgs green (incl. service+handler+store ATDD); `go vet`+`gofmt` clean; vitest **1582 passed** (1 pre-existing FU-2-5b-A RoomsTab flake, unrelated); `tsc` app+e2e clean; `eslint` clean; `i18n-parity` OK (787 keys); `npm run build` clean; Playwright bundle test green. **Deviations (pragmatic):** cross-teacher→404 (AC6 party-mode) over Task4/Task9 stale "403"; service real-DB ATDD over "mock store seam" (no store interface on shipped ClassService); CRUD in `class_crud.go` not `class.go`; template session-preview = `sessionCount` summary (no template-detail endpoint → FU-3-1-A); teacher-assign = pending-email input (FU-3-1-B); ClassStatusPill onSelect not jsdom-drivable (covered by hook+handler tests). Filed FU-3-1/-A/-B. Baseline `dfa65f0` unchanged. Sibling completion-notes updated. Hand-off: `/bmad-code-review 3-1` on a different LLM. |
| 2026-07-20 | **AC6 amendment (`/bmad-code-review 3-1` Chunk 2 decision, Ducdo → defer+document):** the v1 edit dialog intentionally exposes a FIELD SUBSET — `name, description, capacity, startDate, dueDatesEnabled, pendingTeacherEmail`. The PATCH endpoint accepts all AC6 fields, but direct edit inputs for `targetBand, primarySkill, sessionCount, color, endDate` are DEFERRED → **CR-3-1-12** (edit-field completeness). Edit re-sends those 5 unchanged from prefill. |
| 2026-07-19 | Party-mode review pass (Winston/Amelia/Murat/John/Sally). Applied 15 spec edits — decisions: cross-teacher access → **404 not 403** (AC6 + envelope table); paused→ended stays disallowed (Open-Q1 closed); per-field template Switches kept + create-omit wire contract (AC2); capacity **not clearable + CHECK>0** (AC1/Task1). Also: AC4 compare-and-swap concurrency + audit-not-written; AC7 omit inert row + dormant deferred cols + per-tab empty (dimming left as spec's dim-both per §5.6 — Sally's dim-ended-only proposal declined to preserve the shared list-table pattern); AC8 pill-is-the-transition-control; owner/admin must assign teacher (AC1); Task0 AC4/AC5 ATDD unconditionally mandatory; Task2 split-codegen + grep-all-readers; Task6 copy-schema + scoped cache keys; Task7 form-factor-before-e2e; Testing risk add/cut. Rationale in `3-1-proposed-spec-edits.md`; full roundtable in `3-1-party-mode-review-punchlist.md`. |

## Dev Agent Record

_Populated at dev pickup, then split to `3-1-class-crud-lifecycle-and-creation-ui-completion-notes.md` per `docs/bmad-story-conventions.md`._

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

## Review Findings

_`/bmad-code-review 3-1` — Round 1, **Chunk 1 of 2 (Backend `classlite-api`, ~2,615 lines)**. 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor — all completed, no failed layers). 14 unique findings after dedup: 1 decision + 4 patch + 4 defer + 5 dismissed. Chunk 2 (Frontend `classlite-web`) pending its own pass — story does NOT advance to `done` until both chunks clear. Baseline `dfa65f0`._

**Auditor verified FULLY SATISFIED:** AC4 lifecycle transition set is EXACTLY the allowed arrows (`upcoming→active`, `active→{paused,ended}`, `paused→active`, `ended` terminal); same-state + `paused→ended` correctly rejected; compare-and-swap concurrency (0-row → `INVALID_STATUS_TRANSITION`); rejected transition writes NO audit; garbage status → distinct `INVALID_STATUS` 422 at the boundary; teacher-scope → 404 `CLASS_NOT_FOUND` not 403 (AC6); schema migration exact (6 columns + `classes_capacity_positive` CHECK, NO `schedule_pattern`); `updated_at = now()` explicit on every mutation; ClassStatus enum; GO-5 explicit-null response; GO-1/PERF-1 TenantContext + SET-LOCAL-in-tx on all reads/writes; GFW-5 envelope + GO-2 typed errors; api.yaml schema set complete; soft-delete only (no DELETE route); Spawn regression preserved.

### Decision-needed (resolved)

- [x] [Review][Decision→Patch] **Reference validation scope on Create/Update** — RESOLVED by Ducdo 2026-07-20 → **option (b) Minimal: map pg `23503` FK-violation → 422** (see Patch P5). The membership + center-scoped-`templateId` semantics (option a) are deferred to Epic 7 as **CR-3-1-5**. Sources: blind+edge+auditor.

### Patch

_All 5 applied inline 2026-07-20. Verification: `go build ./...` + `go vet ./...` clean; `gofmt` clean; `scripts/codegen.sh` re-run (api.yaml P4) → `client.ts` +468 additive (413 response types), no deletions; full `go test ./...` green. 2 new regression suites added: `TestClassHandler_Student_Forbidden_AllEndpoints` (P1 — student 403 `INSUFFICIENT_ROLE` on all 5 endpoints, the gap the review found untested) + `TestClassHandler_Create_Validation_TargetBandAndBadRefs` (P2 targetBand>9 → 422, P5 nonexistent teacherId → 422-not-500)._

- [x] [Review][Patch] **(BLOCKER) Role gate missing on Create/Get/Update/TransitionStatus — any non-teacher role (e.g. `student`) gets owner-level access** — `classChain` is not role-gated; only `List` gates unknown roles (`default → 403`). `assertTeacherScope` does `if tc.Role != RoleTeacher { return nil }`, so `student` (a valid `center_members` role per Story 2.6 CHECK) and any future role fall through to full center-scoped access: a verified student can `GET`/`PATCH`/`POST /status` any class and `POST /api/classes` (by supplying `teacherId`). Direct violation of AC1 "Allowed roles: owner, admin, teacher"; zero student-blocked assertions in the handler ATDD suite. Fix: gate the four endpoints to `{owner,admin,teacher}` (mirror `List`'s existing default→403, or add to `classChain`). Also makes api.yaml's documented `403 INSUFFICIENT_ROLE` reachable on these paths (Auditor #3). Sources: blind+edge+auditor. [`classlite-api/internal/service/class_lifecycle.go:83-91`, `classlite-api/internal/handler/class_handler.go` Create/Get/Update/TransitionStatus, `classlite-api/cmd/api/main.go:394`]
- [x] [Review][Patch] **(STRONG) `targetBand` range unvalidated despite api.yaml `min 0 max 9`** — `appendScalarClassFieldErrors` validates `capacity`/`sessionCount` (`>0`) but not `targetBand`; column is `numeric(3,1)` with no CHECK. `targetBand:50` stored (band>9), `6.55`→`6.6` silently rounded, `>99.9` overflows `numeric(3,1)` → 500. Add symmetric 0–9 range validation (closes the overflow-500 path too). Sources: blind+edge. [`classlite-api/internal/service/class_crud.go:357-377`]
- [x] [Review][Patch] **(INFO) `Update` stores un-trimmed `name`** — `Create` inserts `strings.TrimSpace(in.Name)`; `Update` passes raw `optText(in.Name)`, so `PATCH {name:"  x  "}` validates on trimmed rune-count but persists the padded string. Trim in `Update` for parity. Source: reviewer. [`classlite-api/internal/service/class_crud.go:260-262`]
- [x] [Review][Patch] **(INFO) api.yaml omits 413 on class write endpoints** — handlers emit `PayloadTooLargeError` (413) via `maxClassBodyBytes`, but no class path documents a 413 response. Add it to `POST /api/classes` + `PATCH /api/classes/{id}` + `POST /api/classes/{id}/status`. Source: blind. [`classlite-api/api.yaml` class paths]
- [x] [Review][Patch] **(STRONG, from resolved decision) Map FK-violation `23503` → 422 in Create/Update** — a well-formed-but-nonexistent `teacherId`/`templateId` currently reaches the INSERT/UPDATE, trips the FK, and is wrapped generically → 500 on client input. Catch pgconn `23503` and return `model.ValidationError` (422) naming the offending field. Membership + cross-center-`templateId` semantics deferred (CR-3-1-5). Source: blind+edge+auditor (Ducdo decision → option b). [`classlite-api/internal/service/class_crud.go` Create/Update]

### Defer

- [x] [Review][Defer] **(STRONG) Teacher can reassign `teacher_id` away via PATCH and self-lock-out** [`classlite-api/internal/service/class_crud.go` Update] — deferred, no AC prohibits teacher reassignment; revisit if product wants owner/admin-only reassignment.
- [x] [Review][Defer] **(INFO) Empty/no-op PATCH `{}` bumps `updated_at` + writes identical before/after `class.updated` audit row** [`classlite-api/internal/service/class_crud.go` Update] — deferred, likely shared with room/term handlers; needs a project-wide "≥1 field present" convention.
- [x] [Review][Defer] **(INFO) PATCH explicit `null` on a nullable field is a silent no-op (200), not a rejection** [`classlite-api/internal/handler/class_handler.go` updateClassRequestBody] — deferred, matches the documented "cannot clear this story" scope; tighten to 422 when null-clear is formally added.
- [x] [Review][Defer] **(INFO) List endpoints have no pagination / LIMIT; `EnvelopeClassList` has no page meta** [`classlite-api/internal/store/queries/classes.sql` ListClasses/ListClassesByTeacher] — deferred, unbounded response acceptable at MVP class volume; add paging when it warrants.

### Dismissed (5)

- **Invite not dispatched on Create/Update with `pendingTeacherEmail`** (blind) — not a spec requirement; invite email flow is Spawn (2.2) / Epic 7. Storing `pending_teacher_email` without a send is intended 3.1 scope; the shared `inviter` is used by Spawn, not dead.
- **`List` teacher identity from a "different source"** (blind) — false: `userIDFromContext` reads the same `TenantFromContext` and returns parsed `tc.UserID`; identical value.
- **Concurrency only holds under READ COMMITTED** (blind) — theoretical; app runs Postgres default READ COMMITTED, no code sets a higher isolation level.
- **Strict decoder doesn't reject trailing JSON** (blind) — matches the shipped room/term `decodeJSONBody` pattern; project-wide, not 3.1-specific.
- **Mutex "XOR" vs DB NAND doc inaccuracy** (auditor) — can't fix (WF-2 forbids editing the 2.2 migration); service correctly enforces "no fully-unassigned" for Create; wording nuance only.

## Review Findings — Chunk 2 (Frontend)

_`/bmad-code-review 3-1` — Round 1, **Chunk 2 of 2 (Frontend `classlite-web`, ~2,150 lines; generated `client.ts` excluded per XL-1)**. 3-layer adversarial pass (Blind + Edge + Acceptance Auditor — all completed, no failed layers). **Auditor found NO blockers / spec-contradictions**; high-risk ACs verified FULLY SATISFIED: AC2 excluded-template-field OMITTED-not-null wire contract, AC4 client transition map = exact backend set (paused→ended NOT offered, ended terminal), AC5 teacher-scope cache separation + RouteRoleGate {owner,admin,teacher} + TEST-FE-6 absence assertion, AC6 set-only PATCH (no null-clear), AC7 Loading/Empty/Error trilogy + s07 8-col layout + dormant Students/Sessions cells, AC8 pill-is-the-control (current state absent, optimistic multi-scope rollback), AC9 66 keys en+vi parity + interpolation-token ratchet. **Pre-review note:** the frontend shipped against a STALE `client.ts` (green-phase never ran codegen after the 3.1 api.yaml change — WF-1/WF-3 miss), which caused the `tsc` errors the LSP flagged; **resolved when Chunk-1 P4 re-ran `scripts/codegen.sh`** — `tsc -p tsconfig.app.json` now 0 errors. 12 findings after dedup: 1 decision + 4 patch + 7 defer._

### Decision-needed (resolved)

- [x] [Review][Decision→Defer] **Edit dialog exposes no inputs for `targetBand` / `primarySkill` / `sessionCount` / `color` / `endDate`** — RESOLVED by Ducdo 2026-07-20 → **option (b) Defer + document**. Filed as **CR-3-1-12**; story-spec AC6 amended with a v1 edit-field-subset note (see Change Log). Original detail retained below.
- [ ] ~~[Review][Decision] Edit dialog exposes no inputs for `targetBand` / `primarySkill` / `sessionCount` / `color` / `endDate` — AC6 lists all as partial-update fields~~ — the create-mode template block is `!isEdit`-gated, and edit mode renders inputs only for name/description/capacity/startDate/dueDates/pendingTeacherEmail. `buildUpdatePayload` re-sends the 5 fields UNCHANGED from `initialFormValues`, so a user editing a class cannot change its target band, primary skill, session count, color, or end date. AC6 explicitly enumerates them as editable; the completion-notes deferrals (FU-3-1/-A/-B) cover validator-extraction / template-detail / teacher-composer, NOT these inputs — so this is undocumented. Auditor did not flag it (treated AC6 as endpoint-contract); Blind flagged INFO. Options: **(a)** add the 5 inputs now (primarySkill `<select>`, targetBand + sessionCount number inputs, color picker, endDate date input); **(b)** formally defer with a documented FU (edit-field completeness) + a story-spec amendment note; **(c)** dismiss as intended-minimal-edit. Sources: blind + reviewer. [`classlite-web/src/features/classes/components/ClassFormDialog.tsx` form body ~175-209]

### Patch

_All 4 applied inline 2026-07-20. Verification: `tsc -p tsconfig.app.json` + `tsc -p tsconfig.e2e.json` clean; `eslint src/features/classes` clean; classes feature + i18n-parity suites green (the parity ratchet now validates the new `_one/_other` keys). New regression test `ClassFormDialog.test.tsx › re-enabling a toggled-off field RESTORES the template value` (FP-A). NOTE: the editor LSP showed transient stale-`client.ts` errors during the edits; the authoritative CLI `tsc` is clean._

- [x] [Review][Patch] **(STRONG) Prefill toggle re-enable silently drops the template value (AC2 contradiction)** — `toggleField` only handles the OFF case (`if (!on) setValue(field, undefined)`); turning a Switch back ON restores nothing. Toggle a field off then on → the Switch reads "included" but `values[field]` is still `undefined`, so `buildCreatePayload`'s `included[field] && value != null` OMITS it. The UI asserts included while the payload drops it. Fix: on re-enable, re-apply the selected template's value for that field. Sources: blind. [`classlite-web/src/features/classes/components/ClassFormDialog.tsx:94-97`]
- [x] [Review][Patch] **(STRONG) English pluralization missing → "1 classes" / "1 sessions planned" (UX-2)** — `classes.countLabel` = `"{{count}} classes"` and `classes.form.sessionPreview` = `"{{count}} sessions planned"` have no i18next `_one/_other` variants; the parity test only checks token parity so it passes CI. Fix: add `_one/_other` key variants (en); vi stays single-form. Sources: blind+edge. [`classlite-web/src/locales/en.json:738,784` + call sites]
- [x] [Review][Patch] **(STRONG, perf) `useSessionSnapshot` inline `subscribe` re-subscribes to the whole QueryCache every render** — `useSyncExternalStore((notify) => queryClient.getQueryCache().subscribe(...))` passes a fresh closure each render, so React unsub/resubscribes to the entire cache on every ClassesPage render. Exact repeat of CR-2-6 P1 (which hoisted `useSessionCacheEntry`'s subscribe to a stable module fn). Fix: hoist the subscribe to a stable module-level function. Source: reviewer. [`classlite-web/src/features/classes/ClassesPage.tsx:57-63`]
- [x] [Review][Patch] **(STRONG) TS-7 cross-feature deep import** — `ClassFormDialog` imports `@/features/onboarding/api/useListTemplates` instead of the barrel `@/features/onboarding` (which exports both `useListTemplates` + `Template`). ESLint `no-restricted-imports` only bans `axios`, so "eslint clean" doesn't certify TS-7. Fix: import from `@/features/onboarding`. Source: auditor. [`classlite-web/src/features/classes/components/ClassFormDialog.tsx:34`]

### Defer

- [x] [Review][Defer] **(STRONG) Edit-mode teacher reassignment-by-email is silently ignored** [`ClassFormDialog.tsx` buildUpdatePayload + initialFormValues] — deferred → FU-3-1-B (teacher composer). When `teacherId` is prefilled, the `else if (pendingTeacherEmail)` branch never fires, so typing a new email in edit mode no-ops with no feedback. Add a mutex guard (or hide the email input when `teacherId` set) when the composer lands.
- [x] [Review][Defer] **(INFO) Schedule column renders raw ISO `startDate`, not an i18n-formatted date (AC7/TS-6)** [`ClassesPage.tsx:255-257`] — deferred; sibling features format via `toLocaleDateString`. Structured schedule is Story 3.4; format the date when that lands.
- [x] [Review][Defer] **(INFO) Raw backend `err.message` (English) surfaced as user copy** [`ClassesPage.tsx:113`, `ClassFormDialog.tsx:109`] — deferred; ties to CR-2-5B-3 (backend error messages not i18n-resolved server-side). Map error `code`→i18n key when the backend error-i18n work lands.
- [x] [Review][Defer] **(INFO) 422 VALIDATION_ERROR `details[]` collapsed to one generic alert** [`ClassFormDialog.tsx:109`] — deferred; unlike RegisterPage (iterates `details` as `[{field,message}]`), the dialog shows only top-level `message`, so the offending field isn't highlighted. Wire per-field errors when the shared field-error helper is extracted.
- [x] [Review][Defer] **(INFO) Dialog template picker has no loading/error state (UX-1 sub-surface)** [`ClassFormDialog.tsx:129-146`] — deferred; a failed `GET /api/templates` yields a silently empty picker. Degrades gracefully (create-from-scratch works). Add a skeleton/error affordance.
- [x] [Review][Defer] **(INFO) `applyTemplate` edge cases** [`ClassFormDialog.tsx:83-92`] — deferred; picking a template clobbers a user-typed name, and choosing "No template" after a selection leaves orphaned prefilled values (toggle wall gone, values still submitted). Guard both when the template UX is revisited.
- [x] [Review][Defer] **(INFO) Transition error UX: single-slot `rowError` + no concurrent-mutation guard** [`ClassesPage.tsx:81,199` + `useTransitionClassStatus.ts:71`] — deferred; concurrent row failures collapse to one alert, a stale `rowError` persists across tab switches, and two in-flight transitions can clobber each other's optimistic patch (no `isMutating` guard). Low-frequency for per-row lifecycle actions.
- [x] [Review][Defer] **(INFO) Minor a11y + cleanup** [`ClassesPage.tsx:145` tabs; `classesKeys.ts:21-24`] — deferred; status filter tabs use `aria-current="page"` (should be `role=tab`/`aria-selected` or `aria-current="true"`); `classesKeys.updateMutation`/`transitionMutation` are defined but unused (CQ-1). Tidy in a cleanup pass.

### Dismissed (Chunk 2)

- **Edit can't clear an optional field** (blind/edge) — spec-sanctioned: AC6 makes PATCH set-only this story ("nullable fields CANNOT be cleared... Clearing support is out of scope"). Truthy-omit is correct.
- **Non-optimistic create/update hooks** (auditor) — spec-conformant: only AC8 (transitions) mandates the optimistic triple, which `useTransitionClassStatus` implements; create/update close the dialog on success, invalidate-only is fine.
- **`name` prefilled but not switch-gated** (auditor) — `name` is the sole required `CreateClassRequest` field; an "exclude name" toggle would build an invalid request. Type-over is the exclude.
- **Disabled query → perpetual skeleton when center absent** (edit) — gated staff always have a resolved center post-onboarding; not reachable on the `/classes` route.
- **Unknown out-of-enum status inflates count / NaN key** (edit) — the backend `classes.status` CHECK constrains the four values; defensive-only.
- **`charAt(0)` avatar initial breaks on astral/emoji names** (edit) — cosmetic, tile is `aria-hidden`.
- **Mutating controls not role-gated within the page** (edit) — the list is server-scoped (a teacher sees only own classes); "New class" is valid for teachers (defaults to self); moot.
- **`ClassWire` duplicated in test fixtures vs generated type** (blind) — test-quality nit; low drift risk given codegen parity tests.
