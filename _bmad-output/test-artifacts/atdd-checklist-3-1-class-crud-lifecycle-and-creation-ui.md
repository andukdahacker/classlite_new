---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-and-red-verification']
lastStep: 'step-02-generation-and-red-verification'
lastSaved: '2026-07-19'
storyId: '3.1'
storyKey: '3-1-class-crud-lifecycle-and-creation-ui'
storyFile: '_bmad-output/implementation-artifacts/3-1-class-crud-lifecycle-and-creation-ui.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-3-1-class-crud-lifecycle-and-creation-ui.md'
generatedTestFiles:
  - 'classlite-api/internal/service/class_lifecycle_atdd_test.go'
  - 'classlite-web/src/features/classes/__tests__/ClassesPage.test.tsx'
  - 'classlite-web/src/features/classes/api/__tests__/handlers.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/3-1-class-crud-lifecycle-and-creation-ui.md'
  - 'docs/project-context.md'
  - '_bmad-output/test-artifacts/test-design/classlite_new-handoff.md'
  - '_bmad-output/test-artifacts/test-design/test-design-architecture.md'
  - '_bmad-output/test-artifacts/test-design/test-design-qa.md'
  - 'classlite-api/internal/test/helpers.go'
  - 'classlite-api/internal/test/fixtures.go'
  - 'classlite-api/internal/test/classes_rls_test.go'
  - 'classlite-api/internal/service/class.go'
  - 'classlite-api/internal/service/class_atdd_test.go'
  - 'classlite-api/internal/middleware/error_mapper.go'
  - 'classlite-api/internal/store/queries/classes.sql'
  - 'classlite-api/migrations/20260703120200_create_classes.up.sql'
---

# ATDD Red-Phase Checklist — Story 3.1: Class CRUD, Lifecycle & Creation UI

_Scoped to the **unconditionally-mandatory** ACs per Task 0 (WF-8): **AC4** (lifecycle transition enforcement — first state machine in the codebase, novelty ≥6 by construction; + compare-and-swap concurrency) and **AC5** (role-scoped `/classes` index — teacher-scope isolation, maps to risk R1 score 9 + R15 score 6). AC1–AC3, AC6–AC9 red tests are engineer-discretion inline during green phase._

## Step 1 — Preflight & Context

**Stack detected:** `fullstack` (Go `classlite-api` + React 19 `classlite-web`).

**Prerequisites (all satisfied):**
- Story approved with clear ACs (9 ACs, BDD) — ✅ `ready-for-dev`.
- Frontend framework: `classlite-web/vitest.config.ts` + `playwright.config.ts` present — ✅.
- Backend framework: Go test harness present (`internal/test/{helpers,fixtures}.go`, `classes_rls_test.go`, `class_atdd_test.go`) — ✅.
- No prior `atdd-checklist-3-1*` — fresh run — ✅.

**Risk backdrop (from system-level test design — no 3.1-specific design exists; net-new):**
- **AC5 → R1** (cross-tenant/teacher leak via missing scope, DATA/SEC, score **9**, J15 adversarial grid) + **R15** (SEC-1: service trusting JWT role alone, score 6 — mutating methods re-fetch role from DB).
- **AC4 → net-new**: class lifecycle state machine + status-transition concurrency are **not captured as any named risk** anywhere → confirms Task 0 "novelty ≥6 by construction". Epic 3's only native risk R19 (recurring-session scope leak) is Story 3.4, not 3.1.

**Key architectural constraints discovered (drive the red-phase shape):**
- Package `test` has **no `fixtures.` sub-package** — all helpers are top-level `test.*`.
- **No handler-level test-server helper** (`test.NewTestServer`/`AuthenticatedRequest` do NOT exist). The shipped `ClassService` Spawn ATDD is **service-level** (`package service_test`) on a **real committed pool** (`test.SetupRawPool` + `test.SuperuserPool`/`test.CountRows` for commit-visible assertions). Red-phase for AC4/AC5 therefore lands at the **service level**, matching shipped precedent. (Story's "mock store seam, TEST-BE-4" is aspirational — the real `ClassService` takes `AuthDB`, not a store interface, so there is no store seam to mock; the shipped pattern uses real DB. Documented deviation; handler-layer ATDD deferred to green-phase inline per the 2-5b precedent.)
- No `CreateClass`/`SeedClass` fixture, no `ListClasses`/`ListClassesByTeacher`/`UpdateClassStatus` query, no `updated_at` column yet → all target code paths are genuinely absent.
- Error mapping (`internal/middleware/error_mapper.go`): `model.ValidationError`→422 `VALIDATION_ERROR` (echoes `Fields`), `ForbiddenError`→403 `FORBIDDEN`, `NotFoundError`→404 (custom `Code`).

## Step 2 — Red-Phase Generation & Verification

### Files generated (3)

| File | Level | ACs | Red mechanism |
|---|---|---|---|
| `classlite-api/internal/service/class_lifecycle_atdd_test.go` | Service (real pool) | AC4, AC5 | compile-red: `TransitionStatus`/`List`/`ListForTeacher` undefined |
| `classlite-web/src/features/classes/__tests__/ClassesPage.test.tsx` | Component (Vitest+MSW) | AC5 | import-red: `@/features/classes/ClassesPage` missing |
| `classlite-web/src/features/classes/api/__tests__/handlers.ts` | MSW fixtures | AC5 | (support file — valid TS, not itself red) |

### Backend test inventory — `class_lifecycle_atdd_test.go` (`package service_test`)

- **`TestClassService_TransitionStatus_AC04_LegalMoves`** — table over the 4 legal arrows (`upcoming→active`, `active→paused`, `active→ended`, `paused→active`): each succeeds, status advances, and **exactly +1** `class.status_changed` audit row is written.
- **`TestClassService_TransitionStatus_AC04_IllegalMoves_RejectAndNoAudit`** — table over 7 illegal moves (`upcoming→ended`, `upcoming→paused`, `active→active` same-state, `paused→ended`, `ended→active`, `ended→paused`, `ended→ended`): each returns `model.ValidationError` carrying `{field:"status", code:"INVALID_STATUS_TRANSITION"}`, status is **unchanged**, and **zero** audit rows are written (rejected transition emits no `class.status_changed`).
- **`TestClassService_TransitionStatus_AC04_ConcurrentRace_ExactlyOneCommits`** — two goroutines race `active→paused` vs `active→ended` from the same row; asserts **exactly one** commits, the loser gets `INVALID_STATUS_TRANSITION`, final status ∈ {paused, ended}, and **exactly one** audit row (compare-and-swap, AC4 MANDATORY).
- **`TestClassService_List_AC05_RoleScopedVisibility`** — owner `List` returns all 3 seeded classes (incl. another teacher's + an unassigned pending-email class); teacher `ListForTeacher` returns **only** the caller's class and asserts the other teacher's class **and** the unassigned class are **ABSENT** (leak guard, maps R1/R15).

Pattern honored: real committed pool (`test.SetupRawPool`), real audit (`realAuditLogger`), commit-visible assertions via `test.SuperuserPool`/`test.CountRows`, deterministic per-test tenants, `t.Cleanup(PurgeUserAndOwnedCenters)`. Reuses `realAuditLogger`/`MockInviteSender`/`strPtr` from the shipped `class_atdd_test.go` (same package — not redeclared). Class rows seeded via superuser-pool raw INSERT using **only base-schema columns** so the seed stays valid before Task 1's column migration.

### Frontend test inventory — `ClassesPage.test.tsx`

- Trilogy: `class-row-skeleton*` on load, class-name rows on success, `role="alert"` on 500.
- **TEST-FE-6 negative (AC5):** teacher render (role seeded on the **module-singleton** `queryClient` via `authKeys.session()`, NOT `RoleProvider`) + teacher-scoped MSW payload → own class present, other teacher's class **absent from DOM** (`queryByText(...).not.toBeInTheDocument()` in `waitFor`).
- **Positive counterpart:** owner render + full payload → the other teacher's class **is** present.

### Red verification (executed)

- **Backend:** `go test -run NONE ./internal/service/` → `build failed` with **only** 5 diagnostics, all `undefined` on `TransitionStatus`(×3)/`List`/`ListForTeacher`. No collateral compile errors. ✅ Honest red.
- **Frontend (type):** `tsc --noEmit -p tsconfig.app.json` → **exactly 1** error: `TS2307 Cannot find module '@/features/classes/ClassesPage'`. ✅
- **Frontend (runtime):** `vitest run ClassesPage.test.tsx` → single failure `Failed to resolve import "@/features/classes/ClassesPage"`; every other import resolved. ✅ Honest red.

### Pinned contracts the green phase MUST satisfy

**Service methods (`internal/service/class.go` + `class_lifecycle.go`):**
```go
func (s *ClassService) TransitionStatus(ctx context.Context, tc model.TenantContext, classID uuid.UUID, newStatus string) (generated.Class, error)
func (s *ClassService) List(ctx context.Context, tc model.TenantContext) ([]generated.Class, error)
func (s *ClassService) ListForTeacher(ctx context.Context, tc model.TenantContext, teacherID uuid.UUID) ([]generated.Class, error)
```
- `TransitionStatus` illegal move → `model.ValidationError{Fields: []model.FieldError{{Field:"status", Code:"INVALID_STATUS_TRANSITION", Message: ...}}}`. Legal move → CAS `UPDATE classes SET status=$new, updated_at=now() WHERE id=$1 AND status=$expected RETURNING ...`; 0-row result → same `INVALID_STATUS_TRANSITION`. Writes `class.status_changed` audit (`Before:{status:old}, After:{status:new}`) in-tx on success only.
- If the green phase returns a different first value from `TransitionStatus` (e.g. a domain DTO), the test's `_, err :=` still holds — only `List`/`ListForTeacher` element `.Name` (string) is read, so any struct with a `Name string` field satisfies it.

**Frontend `@/features/classes/ClassesPage` (default-or-named `ClassesPage` export):** loading renders `data-testid="class-row-skeleton*"`; each class renders its `name` as visible text; fetch error renders `role="alert"`; role/scope read via `useRole()` + `useCurrentCenter()` (module-singleton session), list via a `GET /api/classes` query. Form factor: **Dialog** (no `/classes/new` route).

### Deferred to green-phase inline dev (NOT in the mandatory AC4/AC5 red gate)

- Handler-layer ATDD for AC5 role-branch + AC1/AC6 endpoints (no `test.NewTestServer` helper exists yet — building it is green-phase infra, per the 2-5b precedent).
- Store-integration tests (`ListClasses`/`ListClassesByTeacher`/`UpdateClass`/`UpdateClassStatus` + `due_dates_enabled` DB-default, AC3) — thin sqlc wrappers, added when the queries land (Task 2/9).
- AC1–AC3, AC6–AC9 tests (create→upcoming envelope, template toggles, edit authz 404, status pill optimistic rollback AC8, i18n parity `STORY_3_1_KEYS`, axe) — engineer discretion during green.
- `BandPill` referenced by AC7/Task 6 **does not exist** — it is a NEW component the green phase must create.

## Handoff

Red tests are on the working tree; story stays `ready-for-dev` until green lands (WF-8). Resume with **`/bmad-dev-story 3-1`** (green phase). Task 0 is satisfied — checkbox flipped in the story file.
