# Story 3-3-class-templates-management: Completion Notes

_Implementation record for [`3-3-class-templates-management.md`](./3-3-class-templates-management.md). Status: review (green-phase shipped)._

## Dev Agent Record

### Agent Model Used
Amelia (claude-opus-4-8[1m]) via `/bmad-dev-story 3-3`.

### Debug Log

- **Task 1 / SEC-9 soft-delete vs RLS (load-bearing, Ducdo decision).** PostgreSQL 16.14 rejects a non-owner (`classlite_app`) `UPDATE ... SET deleted_at = now()` when a SELECT policy filters `deleted_at IS NULL` — the archived row falls out of the policy's USING set mid-statement → `ERROR: new row violates row-level security policy`. Reproduced with both PERMISSIVE and RESTRICTIVE `FOR SELECT` policies (would break the real `SoftDeleteTemplate`, not just the test). Resolved → **query-level filter**: SELECT policy stays 2.2 tenant-scope-only; `deleted_at IS NULL` moved into the read queries; red test R4's count query gained the same predicate. SEC-9 amended in `docs/project-context.md`.
- **Standalone `CountClassesByTemplate` dropped** — usedCount is a per-row correlated `COUNT` inside `ListAccessibleTemplates`/`GetTemplateByID`, so a separate query would be dead code (CQ-1). Deviation noted in Task 2.
- **Editor-LSP vs CLI tsc** — throughout the FE work the editor LSP flagged stale "cannot find module @/…" + "React UMD global" + implicit-any false positives (the known stale-generated-`client.ts` footgun from 3.1/3.2). Authoritative `tsc -p tsconfig.app.json` + `-p tsconfig.e2e.json` both exit 0.
- **jsdom + dnd-kit** — real drag simulation needs layout rects jsdom lacks. Reorder is covered by (a) drag-handle a11y (keyboard-operable `<button>` + `aria-label` + `aria-roledescription` from `useSortable`) and (b) end-to-end save-payload order preservation, not a synthetic drag event (per the story's "test persisted order + a11y, not the library").
- **Dropdown→AlertDialog in jsdom** — opening the delete confirm from a `DropdownMenuItem` didn't mount the dialog reliably in jsdom; the delete flow is tested by rendering `TemplateDeleteDialog` directly (cleaner unit of the real logic).

### Completion Notes

**Backend (Tasks 1–6):**
- Migrations `20260720120000_add_template_management_columns` (class_templates `updated_at`+`deleted_at`), `20260720120100_add_template_session_duration` (template_sessions `duration_minutes` int CHECK 5–600).
- Queries: `UpdateTemplate`, `SoftDeleteTemplate`, `DeleteTemplateSessionsByTemplateID`; `ListAccessibleTemplates`/`GetTemplateByID` extended with the usedCount correlated COUNT + `deleted_at IS NULL`; `CreateTemplateSession`/`ListTemplateSessionsByTemplateID` gained `duration_minutes`.
- api.yaml: `GET/PUT/DELETE /api/templates/{id}`; `Template.usedCount`, `TemplateSession.duration`, `TemplateSessionInput.duration`, new `TemplateDetail` + `UpdateTemplateRequest` + `EnvelopeTemplateDetail`.
- Service `template_crud.go`: `GetTemplateDetail`, `UpdateTemplate` (tx: scalars + full-replace sessions + `class_template.updated` audit), `SoftDeleteTemplate` (`class_template.deleted` audit), system-seed `ForbiddenError{Reason: ReasonTemplateReadOnly}` guard. Handler `GetByID`/`Update`/`Delete`. Routing: GET on open `templateChain`, PUT/DELETE on new `templateWriteChain` = chain + `RequireRole("owner","admin")` (main.go + test harness). Error mapper maps `ReasonTemplateReadOnly` → `TEMPLATE_READONLY`.
- Tests: red R1/R2/R4 (RLS) + R5–R10 (handler) green; green-phase `template_crud_3_3_test.go` (admin PUT/DELETE, session_count derivation + full-replace, delete→404, 422 validation, audit rows).

**Frontend (Tasks 7–15):**
- Data layer: `templateKeys` (TS-3, separate from `onboardingKeys`), `useTemplates`, `useTemplate`, `useCreateTemplate`, `useUpdateTemplate` (optimistic detail triple), `useDeleteTemplate` (optimistic list-removal).
- Routes: `/classes/templates` sibling group (owner+admin `RouteRoleGate`), children index/`new`/`:id`/`:id/edit`, each deep-imported → own Rolldown chunk. Route-ordering isolation verified (static `templates` outranks `:id`).
- Screens: s19 `TemplatesIndexPage` (hand-rolled table + trilogy + scope-gated row actions + usedCount), s20 `TemplateDetailPage` (head + session blueprint + 404 + scope-gated Edit/Delete + "Use this template"), s21 `TemplateFormPage` (RHF + `useTemplateSchema`, `@dnd-kit` sortable sessions w/ keyboard sensor, derived sessionCount, optimistic save, create+edit+save-as prefill). `TemplateDeleteDialog` shared confirm w/ usedCount warning.
- Absorbed debt: `ClassFormDialog` picker loading/error, no name-clobber (only prefills empty name) + clean "No template" reset, per-session titled preview via `useTemplate(id)`, `initialTemplateId` preselect (from s20 "Use this template"). `OverviewTab` Actions card wired to Save-as-template (scalars-only, limitation note).
- `@dnd-kit/core`+`/sortable`+`/utilities` added (Rolldown build green — acceptance gate). 81 `classes.templates.*`+picker+save-as i18n keys en+vi at parity; `STORY_3_3_KEYS` (76 keys) + ratchet `['classes.templates.']`.

**Deviations from spec (all recorded):** (1) SEC-9 filter is query-level not policy-level (Ducdo — PG incompatibility); (2) no standalone `CountClassesByTemplate` (usedCount via subquery, avoids dead code); (3) create request also gained `duration` (symmetric create/edit form).

**Verification (all green):** backend `go vet` 0, `go test ./...` all ok, gofmt clean; frontend `tsc` app+e2e 0, `npm run build` (dnd-kit Rolldown) ✓, `eslint` clean, `i18n-parity` 920 keys, `vitest` 1757 passed / 1 pre-existing FU-2-5b-A RoomsTab flake (fails identically in isolation, zero dependency on this diff — NOT a regression). Baseline `e3a5df5`.

### Implementation Plan (summary)
Tasks 1→15 in order (Task 0 ATDD red-phase pre-shipped): migration → sqlc → api.yaml → codegen → service/handler/routing → backend tests → FE data layer → routes → s19 → s20 → s21+dnd → picker debt → save-as-template → i18n → FE tests + full regression.

## File List

### Added
- `classlite-api/migrations/20260720120000_add_template_management_columns.{up,down}.sql`
- `classlite-api/migrations/20260720120100_add_template_session_duration.{up,down}.sql`
- `classlite-api/internal/service/template_crud.go`
- `classlite-api/internal/handler/template_crud_3_3_test.go`
- `classlite-web/src/features/classes/api/templateKeys.ts`
- `classlite-web/src/features/classes/api/useTemplates.ts`
- `classlite-web/src/features/classes/api/useTemplate.ts`
- `classlite-web/src/features/classes/api/useCreateTemplate.ts`
- `classlite-web/src/features/classes/api/useUpdateTemplate.ts`
- `classlite-web/src/features/classes/api/useDeleteTemplate.ts`
- `classlite-web/src/features/classes/lib/useCenterId.ts`
- `classlite-web/src/features/classes/lib/templateSchema.ts`
- `classlite-web/src/features/classes/TemplatesIndexPage.tsx`
- `classlite-web/src/features/classes/TemplateDetailPage.tsx`
- `classlite-web/src/features/classes/TemplateFormPage.tsx`
- `classlite-web/src/features/classes/components/TemplateDeleteDialog.tsx`
- `classlite-web/src/features/classes/__tests__/TemplateDetailPage.test.tsx`
- `classlite-web/src/features/classes/__tests__/TemplateFormPage.test.tsx`
- `classlite-web/src/features/classes/__tests__/TemplatesIndexActions.test.tsx`
- `classlite-web/src/features/classes/tabs/__tests__/OverviewTab.saveAsTemplate.test.tsx`

### Modified
- `classlite-api/internal/store/queries/class_templates.sql` — usedCount subquery + deleted filter + update/soft-delete/replace + duration.
- `classlite-api/api.yaml` — GET/PUT/DELETE /{id}, usedCount, duration, TemplateDetail, UpdateTemplateRequest, envelope.
- `classlite-api/internal/store/generated/*` + `classlite-web/src/lib/api/client.ts` — codegen output (XL-1, not hand-edited).
- `classlite-api/internal/service/template.go` — generatedTemplateToModel row type + usedCount, duration threading in create, audit action consts.
- `classlite-api/internal/model/template.go` — usedCount, duration, TemplateDetail, UpdateTemplateInput.
- `classlite-api/internal/handler/template_handler.go` — GetByID/Update/Delete + duration on session input + update body.
- `classlite-api/internal/service/errors.go` — ReasonTemplateReadOnly const.
- `classlite-api/internal/middleware/error_mapper.go` — TEMPLATE_READONLY mapping.
- `classlite-api/cmd/api/main.go` — GET/PUT/DELETE /{id} routes + templateWriteChain.
- `classlite-api/internal/test/story_2_2_helpers.go` — new routes + write chain in the harness.
- `classlite-api/internal/test/class_templates_3_3_rls_test.go` — R4 reframed to query-level deleted filter (SEC-9 amendment).
- `docs/project-context.md` — SEC-9 amendment (query-level soft-delete filter for tenant-role writes).
- `classlite-web/src/features/classes/components/ClassFormDialog.tsx` — picker loading/error, no name-clobber, per-session preview, initialTemplateId preselect.
- `classlite-web/src/features/classes/ClassesPage.tsx` — honor `createWithTemplateId` nav state.
- `classlite-web/src/features/classes/tabs/OverviewTab.tsx` — Save-as-template Actions card wired.
- `classlite-web/src/routes.tsx` — `/classes/templates` sibling route group.
- `classlite-web/src/features/classes/api/__tests__/handlers.ts` — detail/mutation MSW factories + wire-color eslint-disable.
- `classlite-web/src/features/onboarding/api/__tests__/fixtures.ts` — usedCount on Template fixtures (WF-4 fan-out).
- `classlite-web/src/features/classes/components/__tests__/ClassFormDialog.test.tsx` — picker-await reconcile + CR-3-1-9 tests.
- `classlite-web/src/locales/en.json` + `vi.json` — 81 new keys at parity.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — STORY_3_3_KEYS + ratchet.
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — Story 3.3 template chunk-isolation assertions.
- `classlite-web/package.json` + `package-lock.json` — @dnd-kit deps.

### Deleted
_(none)_
