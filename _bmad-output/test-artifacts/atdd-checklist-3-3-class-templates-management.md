---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests', 'step-05-validate-and-complete']
lastStep: 'step-05-validate-and-complete'
lastSaved: '2026-07-20'
storyId: '3.3'
storyKey: '3-3-class-templates-management'
storyFile: '_bmad-output/implementation-artifacts/3-3-class-templates-management.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-3-3-class-templates-management.md'
generatedTestFiles:
  - 'classlite-api/internal/test/class_templates_3_3_rls_test.go'
  - 'classlite-api/internal/handler/template_handler_3_3_atdd_test.go'
  - 'classlite-web/src/features/classes/__tests__/TemplatesIndexPage.test.tsx'
  - 'classlite-web/src/features/classes/api/__tests__/handlers.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-3-class-templates-management.md'
  - 'docs/project-context.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/story_2_2_helpers.go'
  - 'classlite-api/internal/test/story_3_1_helpers.go'
  - 'classlite-api/internal/test/class_templates_rls_test.go'
  - 'classlite-api/internal/test/template_sessions_rls_test.go'
  - 'classlite-api/internal/handler/template_handler_atdd_test.go'
  - 'classlite-api/internal/service/template.go'
  - 'classlite-api/internal/store/queries/class_templates.sql'
  - 'classlite-api/internal/middleware/error_mapper.go'
  - 'classlite-web/src/features/classes/api/__tests__/handlers.ts'
  - 'classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts'
  - 'classlite-web/e2e/route-bundle-boundaries.spec.ts'
---

# ATDD Red-Phase Checklist — Story 3.3: Class Templates Management

_Scoped to the **story-mandated red-first tests** (Task 0, WF-8). Story 3.3 is **below the formal risk-≥6 ATDD trigger** — R1/R2 (template-table RLS) were discharged at Story 2.2's J15 grid, and Epic 3's only native ≥6 risk (R19, recurring-session scope leak) belongs to Story 3.4. **BUT** 3.3 is a full-stack **mutation** story on tenant tables that adds NEW write surfaces (PUT/DELETE/reorder) + NEW authz (owner+admin write-gating) + a NEW soft-delete invariant, so the story itself mandates four red-first tests. Those four + the write-role matrix + usedCount RLS-scoping are this red phase's scope. The remaining ACs (list/detail/form UI, picker debt, i18n, save-as-template) are engineer-discretion inline during green._

## Step 1 — Preflight & Context

**Stack detected:** `fullstack` (Go `classlite-api` + React 19 `classlite-web`).

**Prerequisites (all satisfied):**
- Story approved with clear ACs (10 ACs, BDD) — ✅ `ready-for-dev`, baseline `e3a5df5`.
- Frontend framework: `classlite-web/vitest.config.ts` + `playwright.config.ts` present — ✅.
- Backend framework: Go test harness present (`internal/test/{helpers,story_2_2_helpers,story_3_1_helpers}.go`, `class_templates_rls_test.go`, `template_sessions_rls_test.go`, `template_handler_atdd_test.go`) — ✅.
- No prior `atdd-checklist-3-3*` — fresh run — ✅.

**Risk backdrop:**
- **No risk score ≥6 is newly introduced.** R1 (score 9, cross-tenant DATA/SEC) + R2 (score 6, per-table RLS) were **discharged for `class_templates`/`template_sessions` at Story 2.2** (23 RLS tests, J15 6-pattern grid ×3, system-seed write-protection). 3.3 adds only UPDATE/DELETE/reorder over those already-tested tables — which **inherit** 2.2's reparent/promote-to-seed WITH-CHECK guards but need their own adversarial coverage for the *new mutation verbs*.
- **R19** (recurring-session scope leak, score 6) → Story 3.4, not 3.3.
- **Security-adjacent surfaces this story introduces** (drive the red phase): (a) write-authz split (owner+admin PUT/DELETE vs open reads); (b) system-seed immutability enforced at the service layer (403 `TEMPLATE_READONLY`), not just RLS invisibility; (c) soft-delete + SEC-9 SELECT-RLS filter; (d) the AC4 "spawned classes unaffected" invariant.

**Key architectural constraints discovered (drive the red-phase shape) — carried from the Story 3.1 ATDD precedent + Story 2.2 template reality:**
- **`TemplateService` takes `AuthDB`, NOT a store interface** (`internal/service/template.go:46-50`, deliberate per `:8-10`). There is **no store seam to mock** — the story's "mock store, TEST-BE-4" is aspirational. Red-phase backend tests land at the **service level on a real committed pool** and at the **handler level via the shipped `NewTestServerFor2_2ForUser` harness** (`story_2_2_helpers.go:92`), matching the shipped `template_handler_atdd_test.go` precedent. This is the same documented deviation recorded for 3.1.
- **Template routes are currently NOT role-gated** (`templateChain` stops at `requireCenter`, `main.go:273-281`). The red PUT/DELETE-as-teacher/student tests will fail today because (a) the endpoints don't exist and (b) even the chain isn't gated — both go green together in Task 5.
- **Missing code paths (all genuinely absent → compile/HTTP-red):** `GET/PUT/DELETE /api/templates/{id}` handlers, `UpdateTemplate`/`SoftDeleteTemplate`/`CountClassesByTemplate` queries, `updated_at`/`deleted_at` columns, `duration_minutes` column, `usedCount` on the DTO, `templateWriteChain` role gate, `TEMPLATE_READONLY` error code.
- **RLS grid precedent:** `class_templates_rls_test.go` already holds the 6-pattern grid + reparent/promote-to-seed WITH-CHECK tests (per the 2.2 research) — the new cross-tenant UPDATE/DELETE tests extend it in-file.
- **Error mapping** (`internal/middleware/error_mapper.go`): `model.ValidationError`→422, `ForbiddenError`→403, `NotFoundError`→404 (custom `Code`). `TEMPLATE_READONLY` will be a new `ForbiddenError` code; `TEMPLATE_NOT_FOUND` reuses the shipped 404 (GetTemplateByID → `pgx.ErrNoRows`).
- **Frontend seam:** MSW at the HTTP boundary (`src/features/classes/api/__tests__/handlers.ts`); i18n ratchet in `i18n-parity-coverage.test.ts`; bundle boundary in `e2e/route-bundle-boundaries.spec.ts`.

**Knowledge fragments loaded:** `test-priorities-matrix` (P0–P3 tagging), `test-levels-framework` (unit/integration/E2E placement), plus project-context TEST-BE-1..4 / TEST-FE-1..6 / SEC-1 / SEC-9 / GO-1 / PERF-1..2 (authoritative, project-specific — supersede the generic fragments where they conflict).

## Step 2 — Generation Mode

**Mode chosen: AI generation** (not browser recording). Rationale: ACs are clear; the mandated red-first scope is standard CRUD + RLS/authz + a soft-delete invariant, which is backend-heavy (service + handler level via the shipped Go harness) with two thin frontend component/e2e assertions. Browser recording adds nothing — the drag-reorder UI (the only recording-worthy interaction) is explicitly **green-phase engineer discretion**, not red-phase mandated. Generation draws from: the story spec, the shipped `template_handler_atdd_test.go` + `class_templates_rls_test.go` precedents, `api.yaml`, and the shipped `class_templates.sql`.

## Step 3 — Test Strategy (AC → scenario → level → priority → red mechanism)

**Scope discipline:** RED covers the security/integrity-adjacent, story-mandated surfaces. Everything else (list/detail/form rendering, dnd-kit reorder UX, picker debt, save-as-template, i18n parity) is **green-phase engineer-discretion inline** per the story's Task 0 and the 3.2 precedent — listed at the bottom so nothing is silently dropped.

| # | Scenario | AC | Level | Prio | Red mechanism (fails today because…) |
|---|---|---|---|---|---|
| R1 | Tenant A `UPDATE` of tenant B's template → 0 rows / row unchanged (re-read as B) | AC4 | Integration (RLS, raw SQL, `*TxDB`) | **P0** | `updated_at`/`deleted_at` columns absent → `column does not exist`; RLS UPDATE WITH-CHECK proves isolation once cols land |
| R2 | Tenant A soft-`DELETE` (`SET deleted_at`) of tenant B's template → row still live for B | AC4/AC7 | Integration (RLS, raw SQL) | **P0** | `deleted_at` column absent → red; then RLS USING(center_id) proves 0-row cross-tenant delete |
| R3 | Tenant A reorder (`UPDATE template_sessions SET session_order`) of tenant B's sessions → rejected | AC6 | Integration (RLS, raw SQL) | **P0** | cross-tenant `UPDATE template_sessions` must affect 0 rows (RLS); asserts the reorder write-path is tenant-safe |
| R4 | SELECT-RLS hides a soft-deleted template from its OWN tenant (SEC-9) | AC5 | Integration (RLS, raw SQL) | **P1** | `deleted_at` + the reCREATE'd SELECT policy `AND deleted_at IS NULL` absent → red |
| R5 | `PUT`/`DELETE /api/templates/{id}` as **teacher** AND **student** → 403 `INSUFFICIENT_ROLE` | AC4 | API (handler, committed pool) | **P0** | endpoints don't exist → 404/405, not 403; green wires `templateWriteChain`=`RequireRole("owner","admin")` |
| R6 | `PUT`/`DELETE` a **system-seed** (`scope:"system"`) id as owner → 403 `TEMPLATE_READONLY` | AC1/AC4 | API (handler) | **P0** | endpoint + the new `TEMPLATE_READONLY` `ForbiddenError` code + service seed-guard all absent → red (pins the exact contract) |
| R7 | `PUT`/`DELETE` a cross-tenant (other center) id → 404 `TEMPLATE_NOT_FOUND` (RLS-invisible, no leak) | AC3/AC4 | API (handler) | **P0** | endpoint absent → red; green returns 404 via `GetTemplateByID` → `pgx.ErrNoRows` |
| R8 | **AC4 invariant:** spawn a class from T → `PUT` T (new sessions) + soft-`DELETE` T → spawned class byte-unchanged, `template_id` still set | AC4 | API (handler, committed pool) | **P0** | PUT/DELETE + spawn-then-verify absent → red; the story's headline data-integrity guarantee |
| R9 | `usedCount` is per-tenant on a SHARED seed: tenants A & B each spawn N/M from seed S → each sees only its own count | AC2 | API (handler) | **P1** | `usedCount` field + `CountClassesByTemplate` query absent → red; proves RLS-scoped aggregate (not global) |
| R10 | `GET /api/templates/{id}` → `{data,meta}` envelope with `sessions[]` carrying `sessionOrder`+`title`+`description`+`duration` + `usedCount` | AC3 | API (handler) | **P1** | endpoint + `duration`/`usedCount` fields absent → red (contract lock, closes FU-3-1-A) |
| R11 | **Role-negative UI:** a **teacher** at `/classes/templates` gets `PermissionDenied`; the template list/rows are ABSENT from the DOM (TEST-FE-6) | AC1 | Component (Vitest + MSW) | **P1** | `TemplatesIndexPage` + the route don't exist → import-red; pairs an owner-visible positive with the teacher-absent negative |

**Level rationale (no duplicate coverage):** RLS write-isolation lives ONCE at the integration/raw-SQL level (R1–R4) — the cheapest place to prove `SET LOCAL` + WITH-CHECK; the API layer (R5–R10) proves authz mapping + envelope contract + the AC4 integrity invariant through the real middleware chain (TEST-BE-3), never re-asserting RLS mechanics; the single component test (R11) proves the role-gate's DOM-absence (TEST-FE-6), not business logic. No E2E in the red phase — the bundle-boundary + drag-reorder e2e are green-phase (`route-bundle-boundaries.spec.ts` extension).

**Red-phase file plan (3 artifacts + 1 MSW extension — mirrors the 3.1 precedent count):**
1. `classlite-api/internal/test/class_templates_3_3_rls_test.go` — **NEW** — R1–R4 (raw-SQL RLS for the new mutation verbs + soft-delete filter).
2. `classlite-api/internal/handler/template_handler_3_3_atdd_test.go` — **NEW** — R5–R10 (authz matrix, seed-403, cross-tenant-404, AC4 invariant, usedCount RLS-scoping, GET-detail contract).
3. `classlite-web/src/features/classes/__tests__/TemplatesIndexPage.test.tsx` — **NEW** — R11 (role-negative + owner-positive three-state seed).
4. `classlite-web/src/features/classes/api/__tests__/handlers.ts` — **EXTENDED** — template MSW factories (`listTemplates`, `getTemplate`, fault variants) for R11.

**Deferred to green-phase inline (documented, not dropped):** s19/s20/s21 full three-state + trilogy rendering; `@dnd-kit` drag-reorder pointer+keyboard persistence; delete-confirm AlertDialog flow; ClassFormDialog picker loading/error + name-clobber (CR-3-1-9); per-session preview consumer (FU-3-1-A frontend); Save-as-template wiring; `STORY_3_3_KEYS` i18n parity + interpolation; axe per screen; `route-bundle-boundaries.spec.ts` templates-chunk assertion; service-layer session_count-derivation + audit-row unit tests. These are standard TEST-FE-*/TEST-BE-* coverage the dev adds turning red→green, not security-adjacent red-first mandates.

## Step 4 — Red-Phase Generation (sequential mode)

**Execution mode:** `sequential` (resolved from `tea_execution_mode: auto`). Rationale: the red surface is 3 small, fully-specified files + 1 MSW extension — dispatching parallel API/E2E subagents to write files already pinned in Step 3 adds latency/cost for zero gain. No browser-E2E red artifact (bundle-boundary + drag-reorder e2e are green-phase).

**Convention deviation (recorded per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]`):** the generic ATDD checklist asks for `test.skip()` scaffolds. This project's authoritative convention (project-context + the 3.1/2.2/2.5b precedents) is **genuinely-failing red tests** — a skipped test is not red. All generated tests are live and **verified failing** (§Step 5). project-context supersedes the generic fragment where they conflict.

### Files generated

| File | New/Extended | Level | Scenarios | Red mechanism |
|---|---|---|---|---|
| `classlite-api/internal/test/class_templates_3_3_rls_test.go` | NEW | Integration (RLS, raw SQL, `*TxDB`, `package test`) | R1, R2, R4 | `column "updated_at"/"deleted_at" does not exist` (Task 1) |
| `classlite-api/internal/handler/template_handler_3_3_atdd_test.go` | NEW | API (committed pool, real chain, `package handler_test`) | R5–R10 | endpoints unrouted → 404/405; `usedCount` field absent (Tasks 2/3/5) |
| `classlite-web/src/features/classes/__tests__/TemplatesIndexPage.test.tsx` | NEW | Component (Vitest + MSW) | R11 | `Failed to resolve @/features/classes/TemplatesIndexPage` (Task 9) |
| `classlite-web/src/features/classes/api/__tests__/handlers.ts` | EXTENDED | MSW fixtures | R11 support | template list factories + `usedCount` + `templatesErrorHandlers` (valid TS on its own) |

**Note on R3 (cross-tenant reorder):** folded into R7 (cross-tenant `PUT` → 404). The pure-DB `template_sessions` reorder-isolation mechanic is **inherited-green from Story 2.2's UPDATE WITH-CHECK policy** — writing a "new" RLS test for already-shipped protection would be a false red. The genuinely-new reorder surface is the API PUT full-replace path, covered by R7.

## Step 5 — Validation & Red-Phase Verification

**Red signal VERIFIED by execution (test DB live):**

```
# Go — internal/test (RLS)
--- FAIL TestRLS_ClassTemplate_3_3_CrossTenantUpdate_Rejected        column "updated_at" does not exist (SQLSTATE 42703)
--- FAIL TestRLS_ClassTemplate_3_3_CrossTenantSoftDelete_Rejected    column "deleted_at" does not exist (SQLSTATE 42703)
--- FAIL TestRLS_ClassTemplate_3_3_SoftDeleted_HiddenFromOwnTenant   column "deleted_at" does not exist (SQLSTATE 42703)

# Go — internal/handler (API)
--- FAIL TestTemplateWrite_3_3_NonAdminRole_Returns403              teacher+student PUT want 403, got 404 (unrouted)
--- FAIL TestTemplateWrite_3_3_SystemSeed_Returns403ReadOnly        PUT seed want 403 TEMPLATE_READONLY, got 404
--- FAIL TestTemplateWrite_3_3_CrossTenant_Returns404               want TEMPLATE_NOT_FOUND code, got plain 404
--- FAIL TestTemplateWrite_3_3_EditAndDelete_DoesNotAffectSpawnedClass  PUT want 200, got 404
--- FAIL TestListTemplates_3_3_UsedCount_IsPerTenantOnSharedSeed    usedCount field absent on seed row (list 200)
--- FAIL TestGetTemplate_3_3_Detail_ReturnsSessionsWithDurationAndUsedCount  GET detail want 200, got 404

# Frontend — vitest
FAIL src/features/classes/__tests__/TemplatesIndexPage.test.tsx
  Failed to resolve import "@/features/classes/TemplatesIndexPage" (all other @/ aliases resolved)
```

Each red maps 1:1 to a green-phase task — no false reds, no test that would pass against the current tree.

**Validation checklist:**
- [x] Prerequisites satisfied (fullstack stack, both frameworks, clear ACs).
- [x] Test files created + **compile clean** (`go test -run ZZZ_NONE ./internal/test/... ./internal/handler/...` → ok; vitest resolves every alias except the page-under-construction).
- [x] Checklist scenarios trace to story ACs (R1–R2/R4→AC4-5, R5–R8→AC4, R9→AC2, R10→AC3/FU-3-1-A, R11→AC1).
- [x] Tests are genuinely-red (verified failing), NOT `test.skip()` — stronger than the generic requirement; project-convention documented.
- [x] Story metadata + handoff paths captured (frontmatter).
- [x] No orphaned browser/CLI sessions (AI-generation mode, no recording).
- [x] Artifacts under `_bmad-output/test-artifacts/` (checklist) + repo test dirs (test files) — no random locations.
- [x] Zero production code touched → zero regression risk to shipped suites.

**Scope honesty — deferred to green-phase inline (NOT dropped):** s19/s20/s21 full three-state + trilogy rendering; `@dnd-kit` drag-reorder pointer+keyboard persistence; delete-confirm AlertDialog; ClassFormDialog picker loading/error + name-clobber (CR-3-1-9); per-session preview consumer (FU-3-1-A FE); Save-as-template wiring; `STORY_3_3_KEYS` parity + interpolation; axe per screen; `route-bundle-boundaries.spec.ts` templates-chunk assertion; service-layer session_count-derivation + audit-row unit tests. These are standard TEST-FE-*/TEST-BE-* coverage the dev adds turning red→green — not security-adjacent red-first mandates.

## Green-Phase Handoff

The red suite is the executable spec for the security/integrity-adjacent surfaces. Turn green in task order:
- **Task 1** (migration: `updated_at`/`deleted_at` + SEC-9 SELECT policy) → RLS R1/R2/R4 green.
- **Task 2/3/4** (queries + api.yaml `usedCount`/`duration`/detail + codegen) → R9/R10 green.
- **Task 5** (GET/PUT/DELETE handlers + `templateWriteChain=RequireRole("owner","admin")` + seed guard + `TEMPLATE_READONLY` + audit) → R5/R6/R7/R8 green.
- **Task 9** (`TemplatesIndexPage`) → R11 green (extend to full three-state during green).

**Completion summary:**
- Test files: 3 new + 1 MSW extension (above).
- Checklist: `_bmad-output/test-artifacts/atdd-checklist-3-3-class-templates-management.md`.
- Story handoff: `_bmad-output/implementation-artifacts/3-3-class-templates-management.md` (story key `3-3-class-templates-management`).
- Key assumptions: `TemplateService` keeps the `AuthDB` seam (no store mock — service/handler-level tests on real DB, per 3.1 precedent); PUT is full-replace (session_count derived); seed mutation is a service-layer 403 before RLS.
- Next: `/bmad-dev-story 3-3` (green phase). `/bmad-tea TA 3-3` (automate) comes AFTER implementation for P2/P3 expansion.
