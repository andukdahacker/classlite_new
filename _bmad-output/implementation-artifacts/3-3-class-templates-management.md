---
baseline_commit: e3a5df5
---

# Story 3.3: Class Templates Management

Status: done

<!-- THIRD story of Epic 3 (epic already in-progress from 3.1/3.2). Audience: FULL-STACK. Deps: Story 2.2 (built class_templates/template_sessions tables + dual-scope RLS + GET /api/templates list + POST create + POST /{id}/spawn) and Story 3.1 (classes table with template_id FK, assertClassRole pattern, ClassFormDialog template picker) + Story 3.2 (the dormant "Save as template" Actions-card affordance deferred here). -->
<!-- SCOPING DECISIONS (Ducdo, 2026-07-20) — four forks resolved before drafting:
  • DELETE semantics → SOFT DELETE (archive): add `deleted_at` + SEC-9 SELECT-RLS filter. Spawned classes keep their `template_id` provenance and survive; "used N times" history is preserved; system seeds are never deletable. (NOT hard-delete, NOT block-when-used.)
  • SESSION "durations" (epic AC2) → ADD `duration_minutes` NOW: new migration column on template_sessions + api.yaml field + edit-form input. (Not deferred — satisfies the literal AC.)
  • DRAG-REORDER (epic AC3) → ADD `@dnd-kit` (`/core` + `/sortable` + `/utilities`). React-19 + Rolldown compatible; ships a keyboard sensor for a11y. **New dependency — human-review-approved by Ducdo 2026-07-20 per the project-context Vite-8/Rolldown "flag new plugins" rule.**
  • SCOPE → ABSORB THE DEBT: this story is "the template UX." It builds s19/s20/s21 + the CRUD/reorder/count API AND fixes CR-3-1-9 (create-dialog picker loading/error + `applyTemplate` name-clobber), consumes FU-3-1-A (new GET /api/templates/{id} detail-with-sessions endpoint) for a per-session picker preview, and wires the Story 3.2 "Save as template" Actions card. -->
<!-- BACKEND REALITY (Story 2.2 shipped): class_templates + template_sessions exist with dual-scope RLS (system seeds center_id IS NULL read-only + tenant-owned read/write); queries List/GetByID/CreateCustom/CreateSession/ListSessions exist; endpoints GET /api/templates + POST + POST /{id}/spawn exist; classes.template_id FK exists (ON DELETE SET NULL). MISSING (this story builds): updated_at + deleted_at on class_templates; duration_minutes on template_sessions; GET/{id} detail endpoint; PUT /{id} update; DELETE /{id} soft-delete; usedCount; UpdateTemplate/SoftDeleteTemplate/replace-sessions/CountClassesByTemplate queries; role-gating on writes (template routes are currently open to ANY authed user with a center). -->
<!-- AC4 IS STRUCTURALLY FREE: spawn does NOT materialize class sessions yet (class_sessions is Story 3.4 — 3.1 deferred materialization). `template_id` is a provenance link, not a live join. Editing/deleting a template therefore cannot retroactively mutate any spawned class. VERIFY-AND-STATE, do not re-implement. -->
<!-- No risk score ≥6 forces mandatory ATDD (R1/R2 were discharged for these tables at Story 2.2's J15 grid; Epic 3's only ≥6 risk R19 is Story 3.4). BUT this is a full-stack MUTATION story on tenant tables — write the cross-tenant PUT/DELETE-rejection, seed-mutation-403, and cross-tenant-reorder tests RED-FIRST even though the formal WF-8 Task-0 ceremony is skipped (3.2 precedent). A never-failed authz test is not evidence. -->

## Story

As an **Admin or Owner**,
I want **to manage class templates with full CRUD, a per-session editor with drag-to-reorder, and a "used N times" signal**,
so that **I can maintain a reusable library of class structures for consistent course delivery — and reuse them from the class-creation flow without re-typing a syllabus.**

## Context: backend reality vs. what this story adds

| Concern | Shipped (Story 2.2) | This story adds |
|---|---|---|
| `class_templates` cols | id, center_id (NULL=seed), name, target_band, primary_skill, session_count, color, created_at | **`updated_at`**, **`deleted_at`** (soft delete) |
| `template_sessions` cols | id, template_id, center_id (denorm, trigger-synced), session_order, title, description, created_at | **`duration_minutes`** (nullable int, CHECK) |
| RLS | dual-scope 4-policy (seeds read-only for tenants) | **SELECT policy gains `AND deleted_at IS NULL`** (SEC-9) |
| Queries | List, GetByID, CreateCustom, CreateSession, ListSessions | **UpdateTemplate, SoftDeleteTemplate, ReplaceTemplateSessions (del+ins in tx), CountClassesByTemplate**; List/GetByID extended (usedCount + deleted filter) |
| Endpoints | `GET /api/templates`, `POST /api/templates`, `POST /api/templates/{id}/spawn` | **`GET /api/templates/{id}`** (detail+sessions+usedCount), **`PUT /api/templates/{id}`** (owner+admin), **`DELETE /api/templates/{id}`** (owner+admin, soft) |
| Frontend | onboarding `useListTemplates`, the `<select>` picker in `ClassFormDialog` | s19 index, s20 detail, s21 create/edit form (dnd-kit reorder), `templateKeys` + hooks, picker fix, Save-as-template |
| `classes.template_id` FK | `ON DELETE SET NULL` (Story 2.2/3.1 set it on spawn + manual create) | consumed by the usedCount `COUNT(*)` — no schema change |

## Acceptance Criteria

1. **Templates index — screen s19 (`/classes/templates`).** A new route renders a list of every template visible to the tenant (system seeds `scope:"system"` + own `scope:"center"`), showing per row: **title** (colored skill/letter tile + name), **skill focus** (`primarySkill`), **session count**, and a **"used N times" counter** (AC2). Columns follow the s07 list pattern (`ClassesPage.tsx:193-221` hand-rolled table) — do NOT invent a new table system (the shared `DataListTable`/`1d-6-data-list-table` is still deferred). The full **Loading / Empty / Error trilogy** (UX-1) is mandatory (skeleton rows matching column shape — never a spinner). A **"New template"** CTA opens the create form (AC6). Each row links to the detail (AC3). **Row actions:** view always; **Edit + Delete are present ONLY for `scope:"center"` rows and ABSENT for `scope:"system"` seeds** (seeds are non-editable — AC4). Route is gated `RouteRoleGate allowedRoles={['owner','admin']} requiredRolesForCopy={['owner','admin']} sectionNameKey="classes"` (reuse the shipped `classes` section key — no `PermissionDenied` change) and lazy/deep-imported so Rolldown emits its own chunk. **Route ordering:** the `/classes/templates*` group is a distinct sibling of the `/classes/:id` detail group; a negative test asserts `/classes/templates` loads the index, NOT the `:id` detail 404.

2. **"Used N times" counter — per-tenant `COUNT` over `classes.template_id`.** A new `CountClassesByTemplate`-style query (`SELECT count(*) FROM classes WHERE template_id = $1`, RLS auto-tenant-scoped, `deleted_at IS NULL` on classes if soft-deleted classes exist) yields the count. `ListAccessibleTemplates` is extended to return `usedCount` per row (correlated subquery or LEFT JOIN + GROUP BY — profile with EXPLAIN, PERF-2: no N+1 loop in Go). The `Template` list DTO + `GET /api/templates/{id}` gain a required `usedCount: integer`. Semantics to honor: (a) counts BOTH spawned and manually-`templateId`-linked classes; (b) on a **shared system seed**, RLS ensures each tenant's `usedCount` reflects only THAT tenant's classes; (c) soft-deleted templates are excluded from the list so their counter is moot.

3. **Template detail — screen s20 (`/classes/templates/{id}`).** A new **`GET /api/templates/{id}`** endpoint (closes **FU-3-1-A**) returns the template + its ordered `sessions[]` (each: `sessionOrder`, `title`, `description`, **`duration`** in minutes) + `usedCount`. Query reuses the shipped `GetTemplateByID` (`class_templates.sql:26`) + `ListTemplateSessionsByTemplateID` (`:45` — this story is its first consumer) under one service call. The detail page renders the class-info head (tile + name + band + skill + session count + usedCount) and the **ordered session blueprint** (`TemplateDetailShell` per `component-inventory.md:143`). Trilogy + **404** for absent OR cross-tenant-invisible templates (RLS → `pgx.ErrNoRows` → `TEMPLATE_NOT_FOUND`, identical surface, no metadata leak). Actions: **Edit** + **Delete** for `scope:"center"` only; a **"Use this template"** affordance routes to class creation with the template preselected (reuses 3.1 prefill). `GET` (list + detail) stays **open to all roles with a center** (the class-creation wizard/picker reads templates — do NOT gate reads to admin+).

4. **CRUD endpoints + authz + audit + soft-delete + the AC4 invariant.**
   - **`PUT /api/templates/{id}`** (full update — symmetric with `POST` create): body = scalars (`name`, `targetBand`, `primarySkill`, `color`) + ordered `sessions[]` (`{title, description, duration}`). Atomic tx: update scalars, **`session_count` is DERIVED = `len(sessions)`** (no separate input; never drifts), **replace** the session set (delete existing template_sessions for the id + insert the new ordered set — `session_order` = array index; the `center_id` sync trigger fires on insert), set `updated_at = now()`, write a **`class_template.updated`** audit row in-tx. Returns the updated detail (AC3 shape). `sessions` minItems 1, maxItems 100 (matches create).
   - **`DELETE /api/templates/{id}`** → **soft delete**: `UPDATE ... SET deleted_at = now(), updated_at = now() WHERE id=$1 AND deleted_at IS NULL`; writes a **`class_template.deleted`** audit row. Returns 204. The template drops out of every list/detail read (SELECT-RLS + query filter). No hard `DELETE`, no `template_sessions` cascade fired.
   - **Authz:** `PUT` + `DELETE` gated **owner+admin** via `middleware.RequireRole("owner","admin")` on a new `templateWriteChain` (mirror `settingsInviteChain`, `main.go:350`). `GET`s stay ungated (all roles w/ center). Roles are DB-authoritative (`tc.Role`).
   - **System-seed guard:** a `scope:"system"` template (center_id NULL) is invisible to the UPDATE/DELETE RLS policies (0 rows). Add an explicit **service-layer guard** that fetches the row, and if `scope == system` returns **403 `TEMPLATE_READONLY`** BEFORE the write (a clean error, not a confusing 404). Cross-tenant (other center) stays **404 `TEMPLATE_NOT_FOUND`** (RLS-invisible).
   - **AC4 invariant (verify-and-state, do NOT re-implement):** editing or soft-deleting a template does **not** affect any already-spawned class. Spawn does not materialize class sessions yet (Story 3.4); `template_id` is provenance only. A regression test proves: spawn a class from a template → edit the template's sessions / soft-delete the template → the spawned class row is byte-unchanged (name/scalars intact; `template_id` still set on edit, still set on soft-delete since the row is not hard-deleted).

5. **Schema migrations + queries + codegen (WF-1/WF-2/WF-3 ordering).** New migration pair(s), never editing 2.2's migrations:
   - `class_templates`: add `updated_at timestamptz NOT NULL DEFAULT now()`, `deleted_at timestamptz NULL`; **DROP + reCREATE the SELECT RLS policy** to add `AND deleted_at IS NULL` (SEC-9 — soft-deleted rows must not surface; seeds keep `deleted_at IS NULL` so they stay visible). Do NOT add a UNIQUE(template_id, session_order) constraint (seed data + WF-2 immutability risk — full-replace-in-tx maintains order integrity instead; document).
   - `template_sessions`: add `duration_minutes integer NULL` with `CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 5 AND 600)` (the 17 seed rows stay NULL — nullable is intentional).
   - Queries (extend `internal/store/queries/class_templates.sql`): `UpdateTemplate`, `SoftDeleteTemplate`, `DeleteTemplateSessionsByTemplateID` + reuse `CreateTemplateSession` for the replace, `CountClassesByTemplate`, and extend `ListAccessibleTemplates`/`GetTemplateByID` with `usedCount` + `deleted_at IS NULL`. Sequence: **migration → `scripts/migrate.sh` → edit `.sql` + `api.yaml` → `scripts/codegen.sh`** (regenerates `store/generated/` Go + `classlite-web/src/lib/api/client.ts`). Generated files are read-only (XL-1). **Trust CLI `tsc -p tsconfig.app.json` + `-p tsconfig.e2e.json`, not the editor LSP** (the stale-`client.ts` footgun bit both 3.1 and 3.2).

6. **Create / edit form — screen s21 (`/classes/templates/{id}/edit` + create mode).** One RHF + `zodResolver(useTemplateSchema())` form (mirror `ClassFormDialog` + `useClassSchema` at `classSchema.ts:57-113`) serving both **create** ("New template" CTA + Save-as-template, AC10 → `POST /api/templates`) and **edit** (`PUT /api/templates/{id}`). Fields: scalars (`name`, `targetBand`, `primarySkill`, `color`) + a **`sessions` field array** (each row: `title`, `description`, `duration`) with **`@dnd-kit` drag-to-reorder** (AC8) + add/remove-session controls. `sessionCount` is DERIVED (display-only = `sessions.length`; the zod schema enforces `sessions.length >= 1`). On save, use the **FW-2 optimistic triple** (`onMutate`/`onError`/`onSettled` — mirror `useTransitionClassStatus.ts:37-73`) invalidating `templateKeys.lists()` + `templateKeys.detail(id)`. `scope:"system"` seeds never reach edit (route guard + API 403). Surface `ApiError` (422 field errors, 403 readonly) inline (no silent failure).

7. **Absorb the 3.1 picker debt (CR-3-1-9 + FU-3-1-A consumer).** In `ClassFormDialog.tsx` (the create-mode template `<select>` at `:133-178`): (a) add **loading + error affordances** — a failed/pending `GET /api/templates` must show a spinner/retry, not a silently-empty picker; (b) **`applyTemplate` must NOT clobber a user-typed `name`** — only prefill an empty name; choosing "No template" after a selection must not orphan prefilled values (restore/clear cleanly); (c) show a **per-session preview** (titles, not just `sessionCount`) by fetching the chosen template's detail via the new **`GET /api/templates/{id}`** (`useTemplate(id)` — AC3). Reconcile the shipped `ClassFormDialog` tests.

8. **`@dnd-kit` dependency (approved) + reorder a11y.** Add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (React-19 + Vite-8/Rolldown compatible). **`npm run build` MUST stay green** (Rolldown compat is the acceptance gate for the new dep). The session-reorder list uses `SortableContext` + a **keyboard sensor** so reordering is operable by keyboard, not mouse-only (TEST-UX-2 / a11y). This is the sole new runtime dependency this story adds.

9. **Save-as-template — wire the Story 3.2 Actions card.** The dormant "Save as template" affordance on the class Overview Actions card (`OverviewTab.tsx`, deferred here by 3.2) opens the create form (AC6) prefilled with the class's `name` + `targetBand` + `primarySkill` + `color` and an **empty sessions list** (user defines ≥1 session before save). **Limitation to document on-screen and in code:** a class has no materialized sessions until Story 3.4, so save-as-template captures scalars only, not a session plan — the copy must set this expectation (never imply it cloned the class's sessions).

10. **i18n (both locales).** New flat `classes.templates.*` keys authored in `en.json` AND `vi.json` at parity (UX-2): list columns + empty/error copy, the **`usedCount` counter with pluralization** (`_one`/`_other`, `{{count}}`), detail head + session-blueprint labels (order/topic/duration), the create/edit form (scalar + session fields, add/remove, drag hint), the delete-confirm `AlertDialog` (with the usedCount warning), the seed read-only note, the picker loading/error copy (AC7), and the Save-as-template copy + limitation note (AC9). Add a `STORY_3_3_KEYS` closed-literal array + `assertI18nParity` + `assertI18nInterpolationParity` + prefix ratchet `['classes.templates.']` to `i18n-parity-coverage.test.ts` (mirror `STORY_3_2_KEYS` ~`:1621`).

## Tasks / Subtasks

- [x] **Task 0 — ATDD red-phase EXECUTED** via `/bmad-tea AT 3-3` (2026-07-20). Formal WF-8 ceremony was skippable (no risk ≥6; R1/R2 discharged at 2.2, R19 is 3.4) but the security-adjacent red-first tests were generated and **verified failing**: 3 RLS tests (`class_templates_3_3_rls_test.go` — cross-tenant UPDATE/soft-DELETE reject + SEC-9 soft-delete filter → `column does not exist`), 6 handler tests (`template_handler_3_3_atdd_test.go` — non-admin PUT/DELETE→403, seed→403 `TEMPLATE_READONLY`, cross-tenant→404 `TEMPLATE_NOT_FOUND`, AC4 spawned-class-unaffected, usedCount RLS-scoping, GET-detail contract → all 404/absent today), 1 FE gate test (`TemplatesIndexPage.test.tsx` — role-negative TEST-FE-6 → missing-module red) + MSW template fixtures. Each red maps 1:1 to a green task (T1/T2-4/T5/T9). Full checklist: `_bmad-output/test-artifacts/atdd-checklist-3-3-class-templates-management.md`. **Green-phase completes the trilogy/dnd/i18n/picker coverage inline** (engineer discretion).

- [x] **Task 1 — Migrations (AC5).** New pair `20260720120000_add_template_management_columns` (class_templates: `updated_at`, `deleted_at`) and `20260720120100_add_template_session_duration` (template_sessions: `duration_minutes` + CHECK 5–600). **SEC-9 deviation (Ducdo 2026-07-20):** the `deleted_at IS NULL` filter is enforced at the QUERY layer, NOT the SELECT RLS policy — PG rejects a tenant-role `UPDATE` that makes the new row SELECT-policy-invisible (`new row violates row-level security policy`), so a policy-level filter makes the soft-delete UPDATE impossible. SELECT policy stays 2.2's tenant-scope-only. `.down.sql` drops the columns. NO edits to 2.2 migrations (WF-2). RLS R1/R2/R4 green. Amendment recorded in `docs/project-context.md` SEC-9.

- [x] **Task 2 — sqlc queries (AC2, AC4, AC5).** Extended `class_templates.sql`: `UpdateTemplate` (scalars+session_count+updated_at, RETURNING), `SoftDeleteTemplate` (SET deleted_at/updated_at WHERE deleted_at IS NULL, RETURNING id), `DeleteTemplateSessionsByTemplateID`, and extended `ListAccessibleTemplates` + `GetTemplateByID` with a per-row `usedCount` correlated COUNT over `classes.template_id` (RLS auto-scopes to tenant — PERF-2 single aggregate) + `deleted_at IS NULL`. `CreateTemplateSession`/`ListTemplateSessionsByTemplateID` gained `duration_minutes`. **Standalone `CountClassesByTemplate` dropped** — usedCount comes from the List/Get subquery, so a separate query would be dead code (CQ-1); noted deviation.

- [x] **Task 3 — api.yaml (AC2, AC3, AC4).** Added paths `GET/PUT/DELETE /api/templates/{id}`; `Template` +`usedCount`, `TemplateSession` +`duration`, `TemplateSessionInput` +`duration`; new `TemplateDetail`, `UpdateTemplateRequest` (no sessionCount — derived), `EnvelopeTemplateDetail`; documented `TEMPLATE_READONLY` (403) + `TEMPLATE_NOT_FOUND` (404) + 401/403/413/422/429/500 on the new paths.

- [x] **Task 4 — codegen (AC5).** `scripts/codegen.sh` run once after Tasks 2+3. Generated Go (`store/generated/*`) + `client.ts` regenerated + compile clean. Not hand-edited (XL-1).

- [x] **Task 5 — Backend service + handler + routing (AC3, AC4).** New `internal/service/template_crud.go`: `GetTemplateDetail`, `UpdateTemplate` (tx: scalars + full-replace sessions + audit `class_template.updated`), `SoftDeleteTemplate` (audit `class_template.deleted`), `scope==system` → `&ForbiddenError{Reason: ReasonTemplateReadOnly}` guard. `template_handler.go`: `GetByID`/`Update`/`Delete` (reuse `requireJSONContent`/`decodeError`/`preflightContentLength`/MaxBytesReader). `main.go` + test harness: `GET /api/templates/{id}` on open `templateChain`; `PUT`+`DELETE` on new `templateWriteChain` = chain + `RequireRole("owner","admin")`. Error mapper maps `ReasonTemplateReadOnly` → `TEMPLATE_READONLY`.

- [x] **Task 6 — Backend tests (AC4, all backend ACs; TEST-BE-1..4).** Red suite green (R1/R2/R4 RLS, R5–R10 handler). Green-phase `template_crud_3_3_test.go`: admin-role PUT/DELETE positive, session_count re-derivation + full-replace + ordered durations, DELETE→GET→404, 422 validation (empty sessions + out-of-range duration), audit-row emission (`class_template.updated`/`.deleted`). Cross-tenant reorder folded into R7 (PUT→404). `go vet`+`gofmt` clean; full `go test ./...` green.

- [x] **Task 7 — Frontend data layer (AC1-6).** New `src/features/classes/api/templateKeys.ts` (`all`/`lists()`/`list(centerId)`/`detail(id)`/`updateMutation(id)`/`deleteMutation(id)` — TS-3, do NOT reuse the wizard-coupled `onboardingKeys`). Hooks: `useTemplates` (list + usedCount), `useTemplate(id)` (detail, surfaces `ApiError` for 404), `useUpdateTemplate` (PUT, optimistic triple), `useDeleteTemplate` (soft delete, optimistic list-removal + rollback), `useCreateTemplate` (POST — extract from/replace any onboarding create path). Reuse `apiFetch` + `ApiError` (`api-fetch.ts`).

- [x] **Task 8 — Frontend routes + gate + chunks (AC1, AC3, AC6).** In `src/routes.tsx`, add a `/classes/templates` sibling group (distinct from `/classes/:id`): index (s19), `:id` (s20 detail), `:id/edit` + `new` (s21). Each deep-imported for its own chunk; wrapped in `RouteRoleGate` owner+admin `sectionNameKey="classes"`. Extend `e2e/route-bundle-boundaries.spec.ts`: templates chunks separate from the s07 index + `/classes/:id` detail chunk; assert `/classes/templates` does NOT resolve to the `:id` 404 (route-ordering negative).

- [x] **Task 9 — s19 Templates index (AC1, AC2).** New `TemplatesIndexPage` — hand-rolled table mirroring `ClassesPage.tsx:193-221` (tile+name, skill, session count, usedCount, scope badge, row actions gated by scope). Trilogy (skeleton rows / EmptyHero / ErrorAlert — mirror `ClassesPage.tsx:334-391`). "New template" CTA → create form.

- [x] **Task 10 — s20 Template detail (AC3).** New `TemplateDetailPage` — head + ordered session blueprint (order/topic/duration), usedCount, trilogy + 404 NotFoundCard (mirror `ClassDetailLayout.tsx:265-285`). Edit/Delete actions (center scope only) + delete-confirm `AlertDialog`. "Use this template" → class create prefilled.

- [x] **Task 11 — s21 create/edit form + @dnd-kit (AC6, AC8).** Add `@dnd-kit/*` deps. New `useTemplateSchema()` (mirror `classSchema.ts`) + `TemplateFormPage` (create/edit). Sessions field array with `SortableContext` drag-reorder + keyboard sensor + add/remove; derived sessionCount; save via create/update hooks (optimistic). Verify `npm run build` green (Rolldown).

- [x] **Task 12 — Absorb picker debt (AC7).** UPDATE `ClassFormDialog.tsx`: loading/error on the template `<select>`; `applyTemplate` no longer clobbers a typed name + clean "No template" reset; per-session preview via `useTemplate(id)`. Reconcile shipped tests.

- [x] **Task 13 — Save-as-template (AC9).** Wire `OverviewTab.tsx` Actions-card "Save as template" → create form prefilled with class scalars + empty sessions + the scalars-only limitation copy.

- [x] **Task 14 — i18n (AC10).** Author `classes.templates.*` en+vi at parity (incl. `usedCount_one/_other`). Add `STORY_3_3_KEYS` + parity + interpolation + `['classes.templates.']` ratchet. `npm run i18n-parity` green.

- [x] **Task 15 — Frontend tests + full regression (all FE ACs).** MSW at HTTP boundary (never mock `useQuery`; `retry:false`; one QueryClient/test). Three-state per screen; **role-negative** (teacher → PermissionDenied on s19, TEST-FE-6); drag-reorder (keyboard + pointer sensor) persists order; delete-confirm flow; picker loading/error + no-name-clobber; axe on each screen; bundle boundary (Task 8). Then `tsc` app+e2e, `eslint`, `vitest`, `i18n-parity`, `npm run build`, and full `go test ./...` all green.

### Review Findings

_`/bmad-code-review 3-3` Round 1 — full 3-layer adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor; no failed layers). 15 findings → 1 decision + 9 patch + 1 defer + 4 dismissed. Baseline `e3a5df5` (working tree)._

**Decision-needed (resolved → patch):**

- [x] [Review][Patch] Request-body cap (16 KiB) rejects a spec-valid ≤100-session template — `UpdateTemplateRequest.sessions`/`TemplateSessionInput` allow `maxItems: 100` (titles ≤200 chars + descriptions), but `maxUpdateTemplateBodyBytes = 16*1024` (`template_handler.go:104`, mirrored on create) trips `MaxBytesReader`/`preflightContentLength` → 413 well before the session-count validator runs. **Resolution (Ducdo 2026-07-21): raise the body cap** to comfortably fit 100 sessions (create + update) so `maxItems: 100` stays honest.

**Patch:**

- [x] [Review][Patch] Create-path session `duration` never validated → 500 not 422 [classlite-api/internal/service/template.go:258 `validateCreateTemplateInput`] — the loop checks only `title`; a `POST /api/templates` session `duration` of 1/0/negative/>600 passes service validation then violates the `template_sessions.duration_minutes CHECK (5–600)` at INSERT → wrapped as `create template: insert session[i]` → 500 INTERNAL_ERROR. The update path (`validateUpdateTemplateInput`) already bounds it — asymmetric. **High.**
- [x] [Review][Patch] Cleared/typed-then-emptied `color` submits `""` → server 422 [classlite-web/src/features/classes/TemplateFormPage.tsx onSubmit] — `color: values.color ?? null` only coerces null/undefined, so an empty string slips through and hits the server guard `*Color == "" → "must be null or a non-empty string"` (template_crud.go:361). Fix: `values.color?.trim() ? values.color : null`. **Medium.**
- [x] [Review][Patch] `targetBand` 0.5-step enforced server-side but not in the zod schema → confusing 422 [classlite-web/src/features/classes/lib/templateSchema.ts targetBand] — schema validates only range 1–9; server also rejects non-0.5 steps. A typed `6.3` (step="0.5" isn't enforced on manual entry) passes client validation and returns a 422 the form surfaces only as a top-level banner (per-field `details` not mapped). Fix: add a 0.5-step refine client-side. **Medium.**
- [x] [Review][Patch] Template CRUD mutations don't invalidate the class-create picker cache [classlite-web/src/features/classes/api/useCreateTemplate.ts / useUpdateTemplate.ts / useDeleteTemplate.ts onSettled] — all three invalidate only `templateKeys.lists()`; the ClassFormDialog picker reads the deliberately-separate `onboardingKeys.templates()` cache, so a soft-deleted template stays offered (and new ones stay absent) until that cache's own staleTime elapses. Fix: also invalidate the picker cache in onSettled. **Medium.**
- [x] [Review][Patch] Non-UUID template id → infinite-retry ErrorState instead of NotFound [classlite-web/src/features/classes/TemplateDetailPage.tsx:~126 / TemplateFormPage.tsx FormLoadError] — pages map only `err.status === 404` → NotFoundCard; a malformed id makes `parseTemplateID` return 422, falling through to a generic ErrorState whose "Retry" can never succeed. Fix: treat 404 **or** 422-bad-id on the detail GET as the not-found surface. **Medium.**
- [x] [Review][Patch] Create-dialog router state never cleared → re-preselect + re-open on refresh [classlite-web/src/features/classes/ClassesPage.tsx:~49,946-961,231-234] — `location.state.createWithTemplateId` is read every render and never cleared on close, so (a) a later plain "New class" re-applies the old template, and (b) a refresh on `/classes` re-opens the dismissed dialog. Fix: `navigate('.', { replace: true, state: null })` after the dialog consumes it. **Low.**
- [x] [Review][Patch] Dead `SEED_INCOMPLETE` retry branch in the management list hook [classlite-web/src/features/classes/api/useTemplates.ts:~46-51] — retry predicate copy-pasted from the onboarding seed-guard; `GET /api/templates` never returns that code. Never-taken branch → CQ-1 dead code. Fix: remove it. **Low.**
- [x] [Review][Patch] AC10 closed-literal gap — AC7 picker keys + AC9 Save-as-template keys omitted from `STORY_3_3_KEYS` [classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts] — `classes.form.templateLoading/templateError/templateRetry` + `classes.detail.actions.saveAsTemplate/saveAsTemplateHint` are absent from the story closed literal and fall outside the `['classes.templates.']` ratchet. Global parity still covers existence; only the story-scoped interpolation assertion is missing. Fix: add the 5 keys. **Low.**
- [x] [Review][Patch] AC1 s19 loading skeleton not column-shaped [classlite-web/src/features/classes/TemplatesIndexPage.tsx `TemplateRowSkeletons`] — AC1 mandates "skeleton rows matching column shape"; renders four plain `h-12 w-full` bars. Satisfies "never a spinner" but not the column-shape clause. Fix: shape the skeleton to the tile/name/skill/sessions/usedCount/scope/actions columns. **Low.**

**Deferred:**

- [x] [Review][Defer] CR-3-3-1 "Use this template" id silently dropped when the picker list errors or the template was soft-deleted between navigation and dialog-open [classlite-web/src/features/classes/components/ClassFormDialog.tsx preset effect] — `!templatesData`/`find` guards leave `presetApplied` false with no message explaining why the action had no effect. Pre-existing UX polish, folds near the picker-cache patch; filed to deferred-work.md.

**Dismissed (4):** spawn soft-delete gap (Blind Hunter, PLAUSIBLE) — verified covered: spawn reads via `GetTemplateByID` (class.go:239) which now carries `deleted_at IS NULL`, so archived templates are un-spawnable; system-seed edit returns 422 (invalid body) before 403 `TEMPLATE_READONLY` — validate-before-authz is defensible and UI-guarded; SEC-9 SELECT RLS policy not recreated with `deleted_at IS NULL` — approved documented deviation (Ducdo 2026-07-20, project-context SEC-9 amendment), query-layer filter proven by RLS test R4; live editor `tsc` "implicitly any"/`Set<string>` diagnostics — stale generated-`client.ts` snapshot (same 3.1/3.2 footgun), authoritative `tsc --noEmit` exits 0.

## Dev Notes

**Reuse map (do NOT reinvent — cite before you build):**

| Need | Reuse | Path |
|---|---|---|
| Template tables + dual-scope RLS + seeds | 2.2 migrations | `classlite-api/migrations/20260703120000_create_class_templates.up.sql`, `..._120100_create_template_sessions.up.sql`, `..._120300_seed_class_templates.up.sql` |
| `classes.template_id` FK (usedCount source) | ON DELETE SET NULL | `migrations/20260703120200_create_classes.up.sql:21` |
| Existing template queries | List/GetByID/CreateCustom/CreateSession/ListSessions | `internal/store/queries/class_templates.sql:20,26,32,39,45` |
| Template handler (extend) | List/Create/Spawn + `requireJSONContent`/`decodeError`/body caps | `internal/handler/template_handler.go:110,149,172,221,29,63` |
| Template service (extend) | `generatedTemplateToModel` (scope derivation), `validateCreateTemplateInput`, `floatToNumeric`, audit const | `internal/service/template.go:232,254,327,39` |
| Role middleware (owner+admin) | `RequireRole("owner","admin")` (invite chain precedent) | `cmd/api/main.go:350` |
| Service-layer role guard precedent | `assertClassRole` allowlist → ForbiddenError | `internal/service/class_lifecycle.go:85-92` |
| api.yaml template schemas (extend) | Template/TemplateSession/CreateTemplateRequest/…/Envelopes | `classlite-api/api.yaml:1899-2044, 2593-2717, 2938-2947` |
| Go template models | Template/TemplateSession/CreateTemplateInput | `internal/model/template.go:38,56,68` |
| Backend test harness + RLS grid | `SetupDB`/`TenantContext`, `NewTestServerFor2_2ForUser`, `CreateClassTemplate`, `AssertRLSViolation`, RLS grid | `internal/test/story_2_2_helpers.go:92,265,411`, `class_templates_rls_test.go`, `template_handler_atdd_test.go` |
| List table + trilogy pattern (s19) | hand-rolled table + skeleton/error/empty | `src/features/classes/ClassesPage.tsx:193-221,234-332,334-391` |
| Not-found card (s20 404) | `NotFoundCard` + 404 branch | `src/features/classes/ClassDetailLayout.tsx:265-285,135-143` |
| Query-key factory shape (TS-3) | `classesKeys` | `src/features/classes/api/classesKeys.ts` |
| Detail read hook (404 surfacing) | `useClass` | `src/features/classes/api/useClass.ts:22` |
| Optimistic triple (FW-2) | `useTransitionClassStatus` | `src/features/classes/api/useTransitionClassStatus.ts:37-73` |
| Envelope unwrap + ApiError | `apiFetch` | `src/lib/api-fetch.ts:200-229,36-67` |
| RHF + zod form + Field + Dialog | `ClassFormDialog` + `useClassSchema` | `src/features/classes/components/ClassFormDialog.tsx:69-118,241-261`, `lib/classSchema.ts:57-113` |
| Existing template consumers (picker) | `useListTemplates` (+ tenant-cache caveat) | `src/features/onboarding/api/useListTemplates.ts:27,10-15`; picker `ClassFormDialog.tsx:133-178` |
| Template card renderer (adapt) | `TemplateCard` (band/skill/session/scope badges) | `src/features/onboarding/components/TemplateCard.tsx` |
| RouteRoleGate + SectionNameKey | reuse `classes` (no PermissionDenied change) | `src/components/shared/RouteRoleGate.tsx`, `PermissionDenied.tsx:32,45` |
| Route group + own-chunk pattern | `/classes` + `/classes/:id` deep-import | `src/routes.tsx:253-283,290-387` |
| Save-as-template host | dormant Actions card | `src/features/classes/tabs/OverviewTab.tsx` |
| i18n parity block precedent | `STORY_3_2_KEYS` | `src/lib/test/__tests__/i18n-parity-coverage.test.ts:1621` |
| Detail shell contract (s20) | `TemplateDetailShell` (DEFER→build here) | `_bmad-output/planning-artifacts/component-inventory.md:143,298` |

**Critical constraints:**
- **Cross-service atomic commit (WF-4).** api.yaml + generated Go + generated `client.ts` + backend handler + frontend consumers land in ONE commit. Adding `usedCount` to the `Template` DTO is additive but touches every template consumer — regen and fix together.
- **codegen ordering (WF-1/WF-3):** migration → `migrate.sh` → `.sql` + `api.yaml` → `scripts/codegen.sh` (last script run). If you touched a `.sql` or `api.yaml`, codegen is mandatory. Generated code is read-only (XL-1).
- **GO-1 / PERF-1:** every store method takes TenantContext; open a tx + `SET LOCAL app.current_tenant_id` even for the GET detail read.
- **GO-2:** service/store return typed errors (`NotFoundError`→404, `ForbiddenError`→403 for `TEMPLATE_READONLY`, `ValidationError`→422). No stdlib errors below handlers.
- **GFW-5:** every response uses the `{data,meta}` envelope; DELETE returns 204 (no body).
- **SEC-1:** write-role check is DB-authoritative (`RequireRole` reads `tc.Role`); do not trust JWT alone. **SEC-9:** the SELECT RLS policy MUST filter `deleted_at IS NULL`.
- **PERF-2:** usedCount must be a single SQL aggregate, never a per-row Go loop.
- **TS-3/TS-6/FW-2/FW-7:** own key factory; dates via i18n formatter; optimistic triple on writes; feature-local components + barrel imports only.
- **UX-1/UX-2/TEST-FE-6:** trilogy on every screen; en+vi parity; assert the teacher-absent DOM on s19 (role gate), not just owner-present.
- **@dnd-kit** is the ONLY new dependency; `npm run build` (Rolldown) green is its acceptance gate.

**Resolved decisions (were open; locked by Ducdo 2026-07-20):**
1. **Soft delete** (`deleted_at` + SEC-9 filter) — NOT hard-delete/block-when-used. Restore/undelete is out of scope.
2. **`duration_minutes` added now** (nullable int, CHECK 5–600; seeds stay NULL).
3. **`@dnd-kit` approved** (Rolldown human-review sign-off recorded here).
4. **Absorb the debt** — picker fix (CR-3-1-9), detail-endpoint consumer (FU-3-1-A), Save-as-template (3.2) all in-scope.
5. **PUT full-replace** update (session_count derived; sessions replaced in-tx) — symmetric with POST create; no dedicated live-persist-on-drop reorder endpoint (single Save persists order; live-persist is a follow-up if product wants it).
6. **Reads stay open**, writes owner+admin. **Section key reuses `classes`.** **No UNIQUE(template_id, session_order)** (seed + WF-2 risk; full-replace maintains integrity).

**Open items to raise at code review (not blockers):**
- AC1 route `/classes/templates` vs UX "within the Classes tabs" (`ux-design-specification.md:483`) — this story ships the standalone route; a Classes-page tab entry pointing at it is a thin follow-up if product wants the tabbed IA.
- Save-as-template captures scalars only (no class sessions until 3.4) — flag if product expected session capture.
- Whether `GET` list/detail should eventually narrow to admin+ once a non-wizard consumer exists (today reads must stay open for the picker).

### References

- [Source: epics/epic-03.md#Story-3.3 lines 91-119] — the 5-AC contract (used-N-times, order/topics/durations, drag-reorder persisted, spawned-unaffected, CRUD+authz); Size M, Full-stack, deps 2.2.
- [Source: epics.md FR-15 line 140 + mapping line 303] — "Templates as first-class entities with ordered session plans," FR-15 → Story 3.3.
- [Source: ux-design-specification.md §6.6 line 404, §8.3 line 483, list pattern line 398] — template loop s19→s22; detail = ordered session blueprint (title/description/documents/exercises); s19 within Classes tabs.
- [Source: component-inventory.md:105,143,298] — `DataListTable` (deferred) + `TemplateDetailShell` (DEFER→build here).
- [Source: architecture.md §4.4 line 981 + 618/641/668] — s19–s22 = Class Management; `template_handler`/`template_service`; queries extend the shipped `class_templates.sql` (arch's `templates.sql` name is a drift — follow shipped reality).
- [Source: 2-2-class-template-and-spawning-api.md:546] — "Story 3.3 owns the edit + delete surfaces."
- [Source: 3-1 completion-notes:47 (FU-3-1-A)] — GET /api/templates/{id} detail-with-sessions → picker per-session preview.
- [Source: deferred-work.md:482 (CR-3-1-9)] — ClassFormDialog picker loading/error + `applyTemplate` name-clobber, "revisit with the template UX."
- [Source: 3-2-class-detail-view-with-tabs.md:114] — "Save as template" Actions-card affordance deferred to Story 3.3.
- [Source: test-design-qa.md / classlite_new-handoff.md:50] — Epic 3's only ≥6 risk (R19) is Story 3.4; R1/R2 template-RLS discharged at Story 2.2 → no mandatory ATDD here.
- [Source: docs/project-context.md] — GO-1/2, GFW-5, SEC-1/9, PERF-2, TS-3/6, FW-2/7, UX-1/2, TEST-BE-1..4, TEST-FE-1..6, WF-1..4, XL-1/2.
- [Source: docs/bmad-story-conventions.md] — 600-line story-file ceiling; sibling `*-completion-notes.md` for Dev Agent Record + File List.

## Testing

**Backend (real DB in tx; store interface as the one service seam; real middleware for handlers — TEST-BE-1..4):**
- **RLS adversarial (extend `class_templates_rls_test.go`):** cross-tenant `UpdateTemplate`/`SoftDeleteTemplate` affect 0 rows; tenant A cannot PUT/DELETE tenant B's template (re-read as B → unchanged); seed rows (`center_id NULL`) invisible to UPDATE/DELETE; `deleted_at IS NULL` SELECT filter hides a soft-deleted row from its own tenant. Deterministic tenant IDs; never `DISABLE ROW LEVEL SECURITY`.
- **Handler ATDD (extend `template_handler_atdd_test.go`):** `GET /api/templates/{id}` → full `{data,meta}` envelope with sessions[] (order/title/description/duration) + usedCount; `PUT` owner/admin → 200 updated detail (session_count re-derived; sessions replaced); `PUT`/`DELETE` as **teacher AND student → 403** (`INSUFFICIENT_ROLE`); seed id `PUT`/`DELETE` → **403 `TEMPLATE_READONLY`**; cross-tenant id → **404 `TEMPLATE_NOT_FOUND`**; `DELETE` → 204 then GET → 404; malformed/oversized body → 422/413.
- **AC4 invariant (regression):** spawn a class from template T → `PUT` T (change sessions) and `DELETE` T → re-fetch the spawned class: scalars unchanged, `template_id` still set. Proves edits/soft-delete never touch spawned classes.
- **usedCount:** two tenants each spawn N/M classes from the SAME system seed → each tenant's list shows only its own count (RLS-scoped); manual `POST /api/classes` with `templateId` also increments; soft-deleted template absent from list.
- **Service unit (mock store / `AuthDB` seam):** session_count = len(sessions); replace = delete-then-insert order; `class_template.updated`/`.deleted` audit rows written in-tx.

**Frontend (MSW at HTTP boundary; never mock `useQuery`; `retry:false`; one QueryClient/test; `createMemoryRouter` for routes):**
- **Three-state per screen (TEST-FE-2):** s19 list, s20 detail, s21 form each render skeleton → data → `role="alert"` error.
- **Role-negative (TEST-FE-6):** a **teacher/student** navigating to `/classes/templates` gets `PermissionDenied` — the template list/rows are ABSENT from the DOM (not merely hidden). Owner/admin see it.
- **Scope gating:** `scope:"system"` rows expose NO edit/delete affordance (assert absent); `scope:"center"` rows do.
- **Drag-reorder (AC6/AC8):** reordering session rows (pointer AND keyboard sensor) updates the field-array order; Save issues a `PUT` with the new `sessionOrder` sequence (MSW asserts payload order).
- **Delete flow:** delete action opens the confirm `AlertDialog` showing the usedCount warning; confirm → optimistic list removal + `DELETE`; error → rollback.
- **Picker debt (AC7):** failed `GET /api/templates` shows error/retry in the picker (not silently empty); typing a name then selecting a template does NOT overwrite the typed name; "No template" resets cleanly; per-session titles preview renders.
- **Save-as-template (AC9):** Actions card opens the create form prefilled with class scalars + empty sessions + the scalars-only note.
- **i18n (TEST-FE-4):** `classes.templates.*` exist in en AND vi; `usedCount_one/_other` pluralize; `STORY_3_3_KEYS` parity green.
- **axe (TEST-FE-5):** each screen clean; drag handles are labelled + keyboard-operable.
- **e2e (AC1):** `route-bundle-boundaries.spec.ts` — templates chunks separate from s07 index + `/classes/:id`; `/classes/templates` loads the index (route-ordering negative).

**Cut as over-testing:** don't re-test the shipped `GET /api/templates` list contract (2.2 owns it) or sqlc codegen itself; no rendered-Vietnamese-string assertions (key-existence only); don't test `@dnd-kit` internals (test the persisted order + a11y, not the library).

## Definition of Done

- [x] AC1–AC10 met; `tsc --noEmit` (app+e2e), `eslint`, `vitest`, `i18n-parity`, `npm run build`, and full `go test ./...` + `go vet ./...` + `gofmt` all green.
- [x] Migrations add `updated_at`/`deleted_at` (class_templates) + `duration_minutes` (template_sessions); SELECT RLS policy filters `deleted_at IS NULL`; down migrations reverse exactly; `codegen.sh` run last (generated Go + `client.ts` regenerated, not hand-edited).
- [x] `GET/PUT/DELETE /api/templates/{id}` live; reads open to all roles w/ center, writes owner+admin; seed mutation → 403 `TEMPLATE_READONLY`; cross-tenant → 404; audit rows written; soft-delete verified (spawned classes byte-unchanged — AC4 regression green).
- [x] usedCount is a single RLS-scoped SQL aggregate (no N+1); per-tenant on shared seeds.
- [x] s19/s20/s21 shipped with the full trilogy; own lazy chunks; role-gated owner+admin; teacher-absent DOM asserted.
- [x] `@dnd-kit` added; reorder operable by keyboard + pointer; `npm run build` (Rolldown) green.
- [x] Absorbed: ClassFormDialog picker loading/error + no name-clobber (CR-3-1-9); per-session preview via new detail endpoint (FU-3-1-A); Save-as-template card wired (3.2).
- [x] Both locales at parity; `STORY_3_3_KEYS` added; axe clean on every screen.
- [x] Atomic cross-service commit; baseline `e3a5df5`. (Left uncommitted for `/bmad-code-review` per project flow.)
- [x] Story file ≤600 lines; Dev Agent Record + File List in `3-3-class-templates-management-completion-notes.md` (created at dev pickup).

## Out of Scope

Hard-delete / block-when-used delete semantics (soft-delete chosen) · template restore/undelete UI · template-level `description` column (only sessions carry description) · `UNIQUE(template_id, session_order)` DB constraint (full-replace maintains integrity) · live-persist-on-drop reorder endpoint (single Save persists order) · narrowing GET reads to admin+ (picker needs open reads) · class **session** materialization / copying template sessions into a spawned class (Story 3.4 — so Save-as-template captures scalars only) · full 12-session seed syllabus (FU-2-2-D / Epic 4) · claim-the-class pending_teacher_email flow (FU-2-2-E / Epic 7 Story 7.1) · `template_sessions` trigger `IF NOT FOUND` hardening (FU-2-2-B — not on the reorder path) · cross-center `templateId` validation on class create/update (CR-3-1-5 / Epic 7) · the Classes-page **tab** entry for templates (standalone route this story; tab is a thin follow-up) · Archive/duplicate-template row actions (Epic 10 `ArchiveBrowser`) · exercises/documents attached to sessions (Epic 4 knowledge hub) · any new env var / third-party service / manual-setup entry (WF-9 not triggered).

## Change Log

| Date | Change |
|---|---|
| 2026-07-20 | **Green-phase shipped `in-progress → review`** via `/bmad-dev-story 3-3`. All 10 ACs + 16 tasks green. Backend: 2 migrations, sqlc (usedCount subquery + soft-delete/update/replace), api.yaml GET/PUT/DELETE `/{id}` + `TemplateDetail`/`UpdateTemplateRequest`/`usedCount`/`duration`, `template_crud.go` (detail/update/soft-delete + seed 403 `TEMPLATE_READONLY` guard + audit), `templateWriteChain` owner+admin. Frontend: `templateKeys`+5 hooks, `/classes/templates` route group (own chunks), s19/s20/s21 (`@dnd-kit` reorder + keyboard sensor), picker debt (CR-3-1-9), Save-as-template (3.2), 81 i18n keys + `STORY_3_3_KEYS`. **AC5 SEC-9 deviation (Ducdo):** `deleted_at IS NULL` filter is QUERY-level not SELECT-policy-level — PG rejects a tenant-role UPDATE that makes the new row policy-invisible (`new row violates row-level security policy`); amended `docs/project-context.md` SEC-9 + reframed red test R4. Also: no standalone `CountClassesByTemplate` (usedCount via subquery, avoids dead code); create request gained `duration` (symmetric form). **Verification:** `go vet`/`gofmt`/`go test ./...` green; `tsc` app+e2e clean; `npm run build` (dnd-kit Rolldown) green; `eslint` clean; `i18n-parity` 920 keys; vitest **1757 passed / 1** pre-existing FU-2-5b-A RoomsTab flake (unrelated, fails in isolation). Baseline `e3a5df5`; artifacts UNCOMMITTED. Dev Agent Record + File List in `3-3-class-templates-management-completion-notes.md`. Next: `/bmad-code-review 3-3` on a DIFFERENT LLM. |
| 2026-07-20 | **ATDD red-phase executed** via `/bmad-tea AT 3-3`. 10 genuinely-failing red tests across 3 new files + 1 MSW extension (`class_templates_3_3_rls_test.go` ×3, `template_handler_3_3_atdd_test.go` ×6, `TemplatesIndexPage.test.tsx` ×1 + templates MSW fixtures in `handlers.ts`). Verified red (test DB live): RLS → `column updated_at/deleted_at does not exist (42703)`; handlers → 404/field-absent; FE → missing-`TemplatesIndexPage` module. Each maps 1:1 to a green task. Zero production code touched. Task 0 checked. Checklist: `atdd-checklist-3-3-class-templates-management.md`. Convention: genuinely-red (not `test.skip()`) per project precedent. Next: `/bmad-dev-story 3-3`. |
| 2026-07-20 | Story created (`ready-for-dev`) via `/bmad-create-story 3-3`. baseline `e3a5df5` (3.1+3.2 committed, clean tree). Third Epic-3 story (epic already `in-progress`). Full-stack. Exhaustive 3-agent research pass (backend/frontend/UX-planning). **Four scoping forks resolved with Ducdo:** (1) DELETE → soft-delete/`deleted_at`+SEC-9; (2) session "durations" → add `duration_minutes` now; (3) drag-reorder → add `@dnd-kit` (Rolldown human-review approved); (4) scope → absorb the debt (CR-3-1-9 picker fix + FU-3-1-A detail endpoint + 3.2 Save-as-template). AC4 (spawned-unaffected) verified structurally free (spawn doesn't materialize sessions pre-3.4). Reads open / writes owner+admin; section key reuses `classes`; PUT full-replace (session_count derived). No risk ≥6 → formal ATDD Task 0 skipped, but cross-tenant PUT/DELETE + seed-403 + reorder + AC4-regression written red-first. 10 ACs, 16 tasks. Sibling completion-notes at first dev pickup. Next: optionally `/bmad-tea AT 3-3`, then `/bmad-dev-story 3-3`. |

## Dev Agent Record

_Populated at dev pickup, then split to `3-3-class-templates-management-completion-notes.md` per `docs/bmad-story-conventions.md`._

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
