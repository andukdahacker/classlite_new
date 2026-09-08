---
stepsCompleted:
  - step-01-preflight-and-context
  - step-02-generation-mode
  - step-03-test-strategy
  - step-04-generate-tests
  - step-05-validate-and-complete
lastStep: step-05-validate-and-complete
lastSaved: '2026-09-07'
storyId: '7.2b'
storyKey: 7-2b-student-lists-and-student-detail-frontend
storyFile: _bmad-output/implementation-artifacts/7-2b-student-lists-and-student-detail-frontend.md
atddChecklistPath: _bmad-output/test-artifacts/atdd-checklist-7-2b-student-lists-and-student-detail-frontend.md
generatedTestFiles:
  - classlite-web/src/features/people/api/__tests__/studentHandlers.ts
  - classlite-web/src/features/people/__tests__/StudentRoutesGate.test.tsx
  - classlite-web/src/features/people/__tests__/StudentsTeacherPage.test.tsx
  - classlite-web/src/features/people/__tests__/StudentsCenterPage.test.tsx
  - classlite-web/src/features/people/__tests__/StudentDetailPage.test.tsx
  - classlite-web/src/features/people/components/__tests__/StudentNotesPanel.test.tsx
inputDocuments:
  - _bmad-output/implementation-artifacts/7-2b-student-lists-and-student-detail-frontend.md
  - _bmad-output/implementation-artifacts/7-2a-student-lists-and-student-detail-backend.md
  - classlite-web/src/lib/api/client.ts
  - classlite-web/src/features/people/__tests__/StaffListPage.test.tsx
  - classlite-web/src/features/people/__tests__/StaffDetailPage.test.tsx
  - classlite-web/src/features/people/__tests__/StaffRoutesGate.test.tsx
  - classlite-web/src/features/people/api/__tests__/handlers.ts
  - docs/project-context.md (TEST-FE-1/2/4/5/6)
  - .claude/skills/bmad-testarch-atdd (knowledge: component-tdd, test-quality, test-priorities-matrix)
---

# ATDD Checklist — Story 7-2b: Student Lists & Student Detail (Frontend)

_Red-phase acceptance scaffolds authored by Murat (Test Architect) on 2026-09-07. Story: [`7-2b-...frontend.md`](../implementation-artifacts/7-2b-student-lists-and-student-detail-frontend.md)._

## Step 1 — Preflight & Context

- **Detected stack:** `fullstack` repo; **this story is `frontend`** (classlite-web).
- **Test framework:** Vitest 4 + Testing Library + MSW 2 + vitest-axe (jsdom). Playwright exists but is **E2E-only** here and is NOT the acceptance seam for a component/route story.
- **Prerequisites:** ✅ Story approved with clear ACs (21 ACs / 9 tasks, `ready-for-dev`); ✅ Vitest configured (`vitest.config.ts`, `src/test/msw-server.ts`, `vitest-setup.ts`); ✅ backend 7-2a shipped + codegen'd (`client.ts` carries all student types).
- **Config flags:** `tea_use_playwright_utils` N/A (component tests, not PW-utils API tests); `tea_browser_automation=auto` — **not used** (no recording; ACs are standard list/detail/CRUD + role-gating).

## Step 2 — Generation Mode

- **Mode: AI generation (sequential).** ACs are standard (roster list, detail composition, notes CRUD, route role-gating) — no live-browser recording needed.
- **House-convention override (documented deviation):** the generic ATDD flow emits Playwright `test.skip()` API/E2E scaffolds. This project's FE red convention ([[reference_atdd_red_convention]], proven by the shipped 7-1a/7-1b/7-2a ATDD) is **Vitest component tests that compile-fail on a missing module — NO `test.skip()`**. The red signal is the `TS2307` import failure of the not-yet-built page/component. Followed the house style for consistency with the shipped suite. Steps 04a/04b (PW API/E2E subagents) intentionally not dispatched.

## Step 3 — Test Strategy (AC → level → priority)

All acceptance tests are at the **component/route level** (the FE mock seam is MSW at the HTTP boundary; `useQuery` is never mocked, TEST-FE-1). Role is seeded on the module-singleton `queryClient`; the page's `useQuery` runs against a separate `createTestQueryClient()`.

| Story AC | Scenario(s) | Level | Priority | File |
|---|---|---|---|---|
| AC1 | teacher allowed on `/students`; owner/admin/student denied; denied copy staff-inclusive | route | **P0** | StudentRoutesGate |
| AC2 | owner/admin allowed on `/people/students`; teacher/student denied; i18n en+vi | route | **P0** | StudentRoutesGate |
| AC3 | 404 → not-found; (route-precedence `/students/import` is a Task-1 unit assertion, not scaffolded here) | route/component | P1 | StudentRoutesGate / StudentDetailPage |
| AC4 | teacher-scope (out-of-scope student absent); My-classes + PerfPill columns; attendance null→"—"; row→`/students/:id` nav | component | **P0/P1** | StudentsTeacherPage |
| AC5 | teacher tabs All/At-risk/New/By-class (+ negative: no Unassigned tab); At-risk filter | component | P1 | StudentsTeacherPage |
| AC6 | trilogy: skeletons / empty (no invite CTA) / error+retry | component | **P0** | StudentsTeacherPage |
| AC7 | center columns Classes + Teacher(s) | component | P1 | StudentsCenterPage |
| AC8 | center tabs (5) + head superscript + Archived negative | component | P1 | StudentsCenterPage |
| AC9 | unassigned amber treatment + perf-unassigned pill | component | P1 | StudentsCenterPage |
| AC10 | total≤100 → no pager; total>100 → pager + `role="status"` note (D6) | component | **P0** | StudentsCenterPage |
| AC11 | detail trilogy + 404 not-found (teacher non-disclosure) + head PerfPill | component | **P0** | StudentDetailPage |
| AC12 | 6-up stat strip; attendance null→"—" never "0%" | component | P1 | StudentDetailPage |
| AC13 | BandScoreChart delta present/omitted (null currentVsFirstDelta); no projection; SkillPerfBars 4 skills, null→em-dash | component | **P0** | StudentDetailPage |
| AC14 | at-risk reasons surfaced; reason copy en+vi | component | P1 | StudentDetailPage |
| AC15 | notes trilogy + chronological flagged/plain variants | component | **P0** | StudentNotesPanel |
| AC16 | composer: empty→disabled; create 201→appears+clears; Attach/@mention absent | component | **P0** | StudentNotesPanel |
| AC17 | flag toggle PATCH; **delete gated author-or-owner (TEST-FE-6 absent-from-DOM for non-author teacher)**; delete 204 | component | **P0** | StudentNotesPanel |
| AC18 | (in-flight disable — covered implicitly by mutation flow; dev to assert during green) | component | P2 | StudentNotesPanel |
| AC19 | i18n key-existence en+vi (denied copy, at-risk reasons) | component | P1 | StudentRoutesGate / StudentDetailPage |
| AC21 | axe on the interactive notes panel (TEST-FE-5) | component | **P0** | StudentNotesPanel |

**Not scaffolded (owned by dev-story, not ATDD):** AC20 (D13 contract marker-strip + codegen — a build step, not a test); AC3 route-precedence `/students/import` (a routes.tsx assertion). The `studentHandlers.ts` fixtures ARE the AC20/D13 drift-guard: typed against `components['schemas'][…]`, they stop compiling if a read shape drifts under the Task-9 codegen re-run.

## Step 4 — Generated Red-Phase Scaffolds

6 files (1 fixtures module + 5 test files), ~50 test cases. All follow the shipped `StaffListPage.test.tsx` harness.

- `studentHandlers.ts` — typed fixtures + MSW handlers (roster center/teacher/empty/overflow/500; detail/404/500; notes list/empty/500/create/create-422/flag/delete/delete-403). **Compiles clean** (drift-guard valid).
- `StudentRoutesGate.test.tsx` — AC1/2/3 allow-deny matrix + denied-copy driver.
- `StudentsTeacherPage.test.tsx` — s10a AC4-6.
- `StudentsCenterPage.test.tsx` — s42 AC7-10.
- `StudentDetailPage.test.tsx` — s10 AC11-14.
- `StudentNotesPanel.test.tsx` — AC15-18 + axe.

## Step 5 — Validation & Red-Phase Confirmation

`npx tsc -b` (the project typecheck gate, [[reference_web_typecheck_gate_is_tsc_b]]) confirms the red state is **exactly** the intended set — no accidental red:

```
StudentDetailPage.test.tsx    TS2307  Cannot find '@/features/people/StudentDetailPage'
StudentRoutesGate.test.tsx    TS2307  Cannot find '@/features/people/StudentsTeacherPage'
StudentRoutesGate.test.tsx    TS2307  Cannot find '@/features/people/StudentsCenterPage'
StudentRoutesGate.test.tsx    TS2322  Type '"teacher"' is not assignable to type '"owner"'   ← driver (see finding 1)
StudentsCenterPage.test.tsx   TS2307  Cannot find '@/features/people/StudentsCenterPage'
StudentsTeacherPage.test.tsx  TS2307  Cannot find '@/features/people/StudentsTeacherPage'
StudentNotesPanel.test.tsx    TS2307  Cannot find '@/features/people/components/StudentNotesPanel'
```

- [x] All acceptance scaffolds fail before implementation (RED) via missing-module import — no `test.skip()`, per house convention.
- [x] `studentHandlers.ts` compiles clean → D13 contract drift-guard is valid against the generated wire types.
- [x] MSW is the only mock seam; `useQuery` never mocked (TEST-FE-1). Role seeded on the singleton queryClient (TEST-FE-6 gating driven by `useRole`).
- [x] Story metadata + handoff paths captured. No orphaned browser sessions (component tests — no browser).
- [x] Temp artifacts under `_bmad-output/test-artifacts/`.

## ⭐ ATDD-surfaced findings (fed back into the story spec, D1)

1. **`PermissionDeniedRoles` cannot express a teacher-gated route.** `requiredRolesForCopy={['teacher']}` is a **compile error** — the type is `['owner','admin'] | ['owner']` (`PermissionDenied.tsx:32`) and `bodyKey`/`requiredRoleSummaryKey` branch owner-vs-owner+admin only. Task 1 must **widen the type + add a teacher body/summary branch**, not just tweak i18n copy. This is a legitimate red-first driver (mirrors how 7-1b's StaffRoutesGate drove the `people` SectionNameKey union). Folded into story D1.
2. **The shipped `section.students` denied copy is owner/admin-worded** ("available to owners and admins") — wrong for the teacher `/students` route. Broaden to staff-inclusive (en+vi) or add a teacher-worded key. Folded into story D1.

## Assumptions / notes for the dev

- SEAMS (data-testids, i18n keys, ARIA roles) the green implementation must expose are documented in each test file's header block. Honor them so the scaffolds pass without rewrite.
- `NEW_STUDENT_WINDOW_DAYS` (tab "New" derivation, D5): fixtures use recent `joinedAt`; align the client const with 7-2a's `NewStudentWindowDays` during green.
- Detail is class-agnostic (D1): tests mount `/people/students/:id`; the same page also serves `/students/:id` (teacher) — one component.
- Teacher role-scope is a **component-level proxy** here (the MSW fixture returns the scoped set; the true enforcement is server-side, 7-2a D3/D11). This is the mandatory DoD security test, not a WF-8 red-first gate.

## Handoff

- **Story:** `_bmad-output/implementation-artifacts/7-2b-student-lists-and-student-detail-frontend.md`
- **Next workflow:** `/bmad-dev-story 7-2b` — implement each task red→green over these scaffolds. Run `/bmad-testarch-automate` (TA) only AFTER implementation to expand coverage.
