---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-09-09'
storyId: '7.3b'
storyKey: 7-3b-enrollment-management-frontend
storyFile: _bmad-output/implementation-artifacts/7-3b-enrollment-management-frontend.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-7-3b-enrollment-management-frontend.md
generatedTestFiles:
  - classlite-web/src/features/people/api/__tests__/enrolmentHandlers.ts
  - classlite-web/src/features/people/__tests__/EnrolmentRoutesGate.test.tsx
  - classlite-web/src/features/people/components/__tests__/EnrolmentComposer.test.tsx
  - classlite-web/src/features/people/components/__tests__/NeedsAttentionList.test.tsx
  - classlite-web/src/features/people/components/__tests__/EnrolmentHistoryTable.test.tsx
inputDocuments:
  - _bmad-output/implementation-artifacts/7-3b-enrollment-management-frontend.md
  - _bmad-output/implementation-artifacts/7-3a-enrollment-management-backend.md
  - classlite-web/src/lib/api/client.ts (EnrollmentActionRequest / EnrollmentHistoryEntry / NeedsAttention / EnrollmentAttentionStudent / EnrollmentOverCapacityClass)
  - classlite-web/src/features/people/__tests__/StaffListPage.test.tsx
  - classlite-web/src/features/people/__tests__/StudentRoutesGate.test.tsx
  - classlite-web/src/features/people/api/__tests__/studentHandlers.ts
  - classlite-web/src/features/classes/api/__tests__/handlers.ts
  - classlite-web/src/components/shared/PermissionDenied.tsx (SectionNameKey union)
  - classlite-web/src/components/domain/sidebarNavConfig.tsx (SIDEBAR_NAV_BY_ROLE)
  - docs/project-context.md (TEST-FE-1/2/4/5/6, TS-4/6, UX-1)
  - .claude/skills/bmad-testarch-atdd (knowledge: component-tdd, test-quality, test-priorities-matrix, test-levels-framework)
---

# ATDD Checklist — Story 7-3b: Enrollment Management (Frontend)

_Red-phase acceptance scaffolds authored by Murat (Test Architect) on 2026-09-09. Story: [`7-3b-...frontend.md`](../implementation-artifacts/7-3b-enrollment-management-frontend.md)._

## Step 1 — Preflight & Context

- **Detected stack:** `fullstack` repo; **this story is `frontend`** (classlite-web). Story D13: pure consumer — no `api.yaml`/codegen/Go change (the 7-3a contract is STABLE, no PROVISIONAL markers).
- **Test framework:** Vitest 4 + Testing Library + MSW 2 + vitest-axe (jsdom). Playwright exists but is **E2E-only** here and is NOT the acceptance seam for a component/route story. `test_stack_type=auto` → component-level.
- **Prerequisites:** ✅ Story approved with clear ACs (16 ACs / 8 tasks, `ready-for-dev`); ✅ Vitest configured (`vitest.config.ts`, `src/test/msw-server.ts`); ✅ backend 7-3a shipped + codegen'd (`client.ts` carries every enrollment type).
- **Config flags:** `tea_use_playwright_utils` N/A (component tests, not PW-utils API tests); `tea_browser_automation=auto` — **not used** (no recording; ACs are standard compose-form + list + table + role-gating). `risk_threshold=p1`.

## Step 2 — Generation Mode

- **Mode: AI generation (sequential).** ACs are standard (compose form, needs-attention list, history table, route role-gating) — no live-browser recording needed.
- **House-convention override (documented deviation):** the generic ATDD flow emits Playwright `test.skip()` scaffolds. This project's FE red convention ([[reference_atdd_red_convention]], proven by the shipped 7-1b/7-2b ATDD) is **Vitest component tests that compile-fail on a missing module — NO `test.skip()`**. The red signal is the `TS2307` import failure of the not-yet-built page/component (plus one `TS2322` union driver — see findings). Steps 04a/04b (PW API/E2E subagents) intentionally not dispatched.

## Step 3 — Test Strategy (AC → level → priority)

All acceptance tests are at the **component/route level** (FE mock seam = MSW at the HTTP boundary; `useQuery`/`useMutation` never mocked, TEST-FE-1). Role is seeded on the module-singleton `queryClient`; each component's own `useQuery` runs against a separate `createTestQueryClient()`. Role-scope is enforced **server-side** (7-3a: middleware `RequireRole` + in-service DB role re-fetch) — the route-gate tests are the UI companion, not a WF-8 gate (R17/R15 were discharged red-first in 7-3a).

| Story AC | Scenario(s) | Level | Priority | File |
|---|---|---|---|---|
| AC1 | owner/admin reach `/people/enrolment`; teacher/student denied (`permission-denied-section-header`) | route | **P0** | EnrolmentRoutesGate |
| AC2 | NEW Enrolment sidebar item present for owner+admin, **absent** for teacher/student (TEST-FE-6) | config | P1 | EnrolmentRoutesGate |
| AC3 | compose renders combobox + Add/Transfer/Withdraw toggle + target picker + date (max today) + note | component | **P0** | EnrolmentComposer |
| AC4 | action toggle switches required/visible fields (Add=target only; no source field) | component | **P0** | EnrolmentComposer |
| AC5 | source-class resolution: unassigned→Transfer/Withdraw disabled; 1→auto read-only; >1→picker (D8) | component | **P0/P1** | EnrolmentComposer |
| AC6 | valid Add POSTs explicit `action`+`toClassId` (NOT legacy `classId`); success resets | component | **P0** | EnrolmentComposer |
| AC7 | all 7-3a error codes have en+vi copy; a 422 does NOT reset the form; raw code/HTTP never in DOM; self-transfer blocked client-side (no POST) | component | **P0/P1** | EnrolmentComposer |
| AC8 | two zones: amber unassigned (name+email) / red over-capacity (`activeCount/capacity`); per-zone pager (D11) | component | **P0** | NeedsAttentionList |
| AC9 | unassigned "Add" → `onAddStudent(studentId)` (composer prefill seam) | component | **P0** | NeedsAttentionList |
| AC10 | over-capacity is informational (no action button); trilogy | component | P1 | NeedsAttentionList |
| AC11 | history rows + toned action pills; `performerName===null`→"System"; null from/to→em-dash | component | **P0** | EnrolmentHistoryTable |
| AC12 | pager on total>pageSize; class filter issues server-side `?class_id` | component | **P0** | EnrolmentHistoryTable |
| AC13 | history trilogy (skeleton / empty / error+alert) | component | **P0** | EnrolmentHistoryTable |
| AC14 | i18n key-existence en+vi (`section.enrolment.header`, `sidebar.{owner,admin}.enrolment`) | route/config | P1 | EnrolmentRoutesGate |
| AC15 | axe on the interactive compose form (TEST-FE-5) | component | **P0** | EnrolmentComposer |

**Not scaffolded (owned by dev-story, not ATDD):** AC16 (the D13 no-change gate — `tsc -b`/ESLint/suite-green, a build assertion not a test); AC9 the exact page-level prefill *wiring* (the callback contract IS scaffolded via `onAddStudent`; the composer-receives-prefill integration is a page assembly step). The `enrolmentHandlers.ts` fixtures ARE the standing contract drift-guard: typed against `components['schemas'][…]`, they stop compiling if any enrollment shape drifts.

## Step 4 — Generated Red-Phase Scaffolds

5 files (1 fixtures module + 4 test files), ~36 test cases. All follow the shipped `StaffListPage.test.tsx` / `StudentRoutesGate.test.tsx` harness (I18nextProvider→per-test QueryClientProvider→MemoryRouter; session on the singleton `queryClient`).

- `enrolmentHandlers.ts` — typed fixtures + MSW handlers (action add-201/ok-200 + 7 error codes with body-capture; history list/empty/paged/500; attention populated/empty/unassigned-paged/500). **Compiles clean** (drift-guard valid). Reuses studentHandlers (`studentNormal`=1 class, `studentGood`=2, `studentUnassigned`=0) + classes `classesHandlers` for the combobox/pickers.
- `EnrolmentRoutesGate.test.tsx` — AC1/2/14 gate matrix + sidebar-config presence/absence + i18n en+vi.
- `EnrolmentComposer.test.tsx` — AC3-7 + AC15 axe (fields, action-switch, source-class resolution, submit gating, wire-shape, error mapping, self-transfer guard).
- `NeedsAttentionList.test.tsx` — AC8-10 (two zones, add callback, informational over-capacity, per-zone pager, trilogy).
- `EnrolmentHistoryTable.test.tsx` — AC11-13 (rows, pills, System/em-dash, pager, server-side class filter, trilogy).

## Step 5 — Validation & Red-Phase Confirmation

`npx tsc -b` (the project typecheck gate, [[reference_web_typecheck_gate_is_tsc_b]]) confirms the red state is **exactly** the intended set — total project error count = **5**, no accidental red:

```
EnrolmentRoutesGate.test.tsx(38,31)      TS2307  Cannot find '@/features/people/EnrolmentPage'
EnrolmentRoutesGate.test.tsx(92,19)      TS2322  '"enrolment"' is not assignable to type 'SectionNameKey'   ← driver (finding 1)
EnrolmentComposer.test.tsx(56,35)        TS2307  Cannot find '@/features/people/components/EnrolmentComposer'
EnrolmentHistoryTable.test.tsx(44,39)    TS2307  Cannot find '@/features/people/components/EnrolmentHistoryTable'
NeedsAttentionList.test.tsx(40,36)       TS2307  Cannot find '@/features/people/components/NeedsAttentionList'
```

- [x] All acceptance scaffolds fail before implementation (RED) via missing-module import (+ one intentional union-widening type error) — no `test.skip()`, per house convention.
- [x] `enrolmentHandlers.ts` compiles clean → contract drift-guard valid against the generated 7-3a wire types.
- [x] MSW is the only mock seam; `useQuery`/`useMutation` never mocked (TEST-FE-1). Role seeded on the singleton queryClient (TEST-FE-6 gating driven by `useRole`).
- [x] Story metadata + handoff paths captured. No orphaned browser sessions (component tests — no browser).
- [x] Artifacts under `_bmad-output/test-artifacts/`.

## ⭐ ATDD-surfaced findings (fed back into the story spec)

1. **`SectionNameKey` cannot express an enrolment-gated route — it must be WIDENED, not just given a new i18n key.** `sectionNameKey="enrolment"` is a **compile error** today: `SectionNameKey` (`PermissionDenied.tsx:45`) is a closed union (`settings|permissions|billing|classes|schedule|students|people|exercises|knowledgeHub|assignments|grading`) that omits `'enrolment'`. Story D1/Task 1 named the new `app.permissionDenied.section.enrolment.header` i18n key but did NOT mention widening the type union. This is a legitimate red-first driver (mirrors how 7-1b's StaffRoutesGate drove the `people` union addition). **Folded into story Task 1** (see Change Log entry 2026-09-09). Note: `requiredRolesForCopy={['owner','admin']}` already type-checks (no widening needed there — the roles union already includes it).

## Assumptions / notes for the dev

- SEAMS (data-testids, i18n keys, ARIA roles) the green implementation must expose are documented in each test file's header block. Honor them so the scaffolds pass without rewrite.
- **cmdk combobox seam:** the student field must render options as `role="option"` named by student name (the tests open `data-testid="enrolment-student-combobox"` then click the option). If cmdk under jsdom proves fiddly, the hand-rolled `AssignClassPanel` listbox fallback (story D9) satisfies the same `role="option"` contract.
- **Source-class fixtures (D8):** `studentUnassigned` (activeEnrollmentCount 0), `studentNormal` (1 active class `cls-1`), `studentGood` (2 classes `cls-1`,`cls-2`) from `studentHandlers.ts` — reused so the resolution branches are testable without new fixtures. Confirm during green that `StudentListItem.enrolledClasses` is the *active* set (story D8 flag).
- **Toasts:** the composer error tests assert deterministic signals (form does NOT reset + i18n key existence + raw code absent) rather than sonner portal text, to avoid Toaster-mount fragility. Assert toast text in green only if the harness mounts `<Toaster />`.
- **History filter test** asserts the fetch carries `?class_id` after a filter interaction; the exact filter control shape (`Select` vs listbox) is a dev choice — keep the `data-testid="history-filter-class"` seam and the server-side param.

## Handoff

- **Story:** `_bmad-output/implementation-artifacts/7-3b-enrollment-management-frontend.md`
- **Next workflow:** `/bmad-dev-story 7-3b` — implement each task red→green over these scaffolds (start with the Task-1 `SectionNameKey` widening so EnrolmentRoutesGate compiles). Run `/bmad-testarch-automate` (TA) only AFTER implementation to expand coverage.
