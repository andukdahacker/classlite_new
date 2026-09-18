---
stepsCompleted: ['step-01-preflight-and-context', 'step-02-generation-mode', 'step-03-test-strategy', 'step-04-generate-tests']
lastStep: 'step-04-generate-tests'
lastSaved: '2026-09-16'
storyId: '8.1b'
storyKey: '8-1b-role-specific-dashboards-frontend'
storyFile: '_bmad-output/implementation-artifacts/8-1b-role-specific-dashboards-frontend.md'
atddChecklistPath: '_bmad-output/test-artifacts/atdd-checklist-8-1b-role-specific-dashboards-frontend.md'
generatedTestFiles:
  - 'classlite-web/src/features/dashboard/api/__tests__/handlers.ts'
  - 'classlite-web/src/features/dashboard/__tests__/DashboardRoute.test.tsx'
  - 'classlite-web/src/features/dashboard/api/__tests__/useDashboard.test.tsx'
  - 'classlite-web/src/features/dashboard/__tests__/TeacherDashboard.realDashboard.test.tsx'
  - 'classlite-web/src/features/dashboard/__tests__/OwnerDashboard.test.tsx'
  - 'classlite-web/src/features/dashboard/__tests__/StudentDashboard.test.tsx'
  - 'classlite-web/src/features/dashboard/__tests__/dashboard.i18n.test.ts'
inputDocuments:
  - '_bmad-output/implementation-artifacts/8-1b-role-specific-dashboards-frontend.md'
  - '_bmad-output/project-context.md'
  - 'classlite-web/src/features/people/__tests__/StaffListPage.test.tsx'
  - 'classlite-web/src/features/people/api/__tests__/handlers.ts'
  - 'classlite-web/src/lib/api/client.ts (DashboardData + EnvelopeMeta schemas)'
  - 'classlite-web/src/hooks/useRole.ts'
  - 'classlite-web/src/features/dashboard/TeacherDashboard.tsx'
  - 'resources/knowledge: data-factories, component-tdd, test-quality, test-healing-patterns, selector-resilience, timing-debugging'
---

# ATDD Red-Phase Checklist — Story 8-1b (Role-Specific Dashboards — Frontend)

## Step 1 — Preflight & Context

### Stack detection
- `detected_stack` = **frontend** (classlite-web: React 19 / Vite 8 Rolldown / TanStack Query / React Router v7).
- Test framework: **Vitest 4 + @testing-library/react 16 + MSW 2 + vitest-axe + jsdom**. Gate = `tsc -b` (per [[reference_web_typecheck_gate_is_tsc_b]]). E2E Playwright exists but is NOT the level for this story.
- TEA flags: `tea_use_playwright_utils: true` but **N/A** here — component tests, not PW-utils. `tea_browser_automation: auto`.

### Risk posture (WF-8)
- Story `risk_score: 5` (< 6). The ≥6 WF-8 hard ATDD gate (per-role scoping + query-count + cross-tenant RLS) was **discharged red-first in 8-1a**. Here ATDD is **recommended, not mandatory** (mirrors 7-2b).
- The one correctness-critical concern surfaced here: **role-branch renders exactly the caller's block; the other two blocks are null and their components never mount** (TEST-FE-6). This is the MANDATORY DoD test and the spine of the red scaffold.

### Red convention ([[reference_atdd_red_convention]])
- FE red = import not-yet-existing modules → `tsc -b` + Vitest import failure. **No `test.skip()`.**
- Fixtures file is VALID TS on its own, typed against the **already-shipped generated wire types** (`components['schemas']['Dashboard*']`) — this is the **D13 contract co-finalization drift guard**: if a dashboard shape drifts under codegen, fixtures stop compiling.

### Harness contract (mirrors StaffListPage.test.tsx / ClassesPage.test.tsx EXACTLY)
- Role seeded on the **module-singleton** `queryClient` via `setQueryData(authKeys.session(), …)` (useRole subscribes to the singleton).
- Page's own `useDashboard` query runs against a **separate** `createTestQueryClient()` provider.
- Provider stack: `I18nextProvider(i18n)` → `QueryClientProvider(client)` → `MemoryRouter` + `Routes`.
- MSW is the ONE mock seam (`server.use(...)`; reset in `afterEach`).
- `meta.serverTime` injected via fixture envelope — all "live now"/countdown/"N ago" asserted against the injected clock, never `Date.now()` (D16).

### Wire contract (verified in client.ts — fixtures type against these)
- `EnvelopeDashboard { data: DashboardData, meta: EnvelopeMeta }`; `EnvelopeMeta { serverTime }`.
- `DashboardData { role: 'teacher'|'admin'|'owner'|'student'; teacher|owner|student: … | null }` — exactly one non-null.
- Teacher: `weekSessions[]`, `needsGrading{count,items[]}`, `unansweredQuestions{count,items[]}`, `atRiskStudents{count,items[]}`.
- Owner: `pulse{5 counts}`, `todaySessions[]` (teacherName+enrolledCount non-null), `needsAttention{unassignedStudents, atRiskStudents, capacity{percentUsed 0..1, approaching}, pendingInvites}`.
- Student: `upcomingSessions[]`, `dueSoon[]{submissionId? → Continue/Start}`, `recentFeedback[]{overallBand?}`, `myQuestions[]`.
- At-risk `reasons`: `'attendance_below_floor'|'consecutive_missed'|'band_drop'`.
- Onboarding-complete signal = `OnboardingProgressResult.currentStep === 'done'` (drives AC4/AC5 teacher split).

### Prerequisites — PASS
- Story `ready-for-dev`, 20 clear ACs. Framework configured. Env available. No HALT.

## Step 2 — Generation Mode

- **Mode: AI Generation.** ACs clear; scenarios standard (role-branch render, three-state trilogy, MSW fixtures, serverTime injection). Backend done in 8-1a — no live-browser recording needed; these are jsdom component tests mirroring the shipped `StaffListPage.test.tsx` harness. `tea_browser_automation: auto` → recording skipped (no runtime UI to snapshot pre-implementation).

## Step 3 — Test Strategy

### Level selection
- **Component (jsdom + RTL + MSW)** for every rendering/behavior AC — the story bars E2E for business logic; per-role scoping, query-count and cross-tenant RLS were already red-tested in 8-1a. No new API/contract red tests here (backend frozen; the fixtures-typed-against-generated-types file is the D13 drift guard, enforced by `tsc -b`).
- **Module/unit** for AC2 route-inventory and AC18 i18n key parity.
- **Not red-tested:** AC19 contract co-finalization (a dev codegen/marker-strip task — verified by `tsc -b`=0 + fixtures compiling against generated shapes, not a runtime test).

### AC → scenario → level → priority

| AC | Scenario | Level | Pri |
|---|---|---|---|
| 1 | `/dashboard` dispatches exactly ONE role component; `useRoleLoading()` → checking state (never wrong dashboard) | Component | **P0** |
| 2 | `/student` route no longer matches (retired); student "Dashboard" resolves `/dashboard` | Module/route | P1 |
| 3 | No `RouteRoleGate` on `/dashboard` (all roles reach dispatcher); single `useDashboard` fetch is the only call | Component | P1 |
| 4 | Teacher onboarding-**incomplete** → Epic-2 shell (WelcomeBackBanner + FinishSetupCard) UNCHANGED | Component | **P0** |
| 5 | Teacher onboarding-**complete** → real week-strip + 3 rails (needsGrading/unansweredQuestions/atRisk) | Component | **P0** |
| 6 | Rail headline = `block.count`; "View all →" routes out; overdue flag server-computed; glance disclaimer | Component | P1 |
| 7 | Teacher trilogy (skeleton / empty-per-rail / inline `role=alert` + retry→refetch) | Component | **P0** |
| 8 | Owner/Admin 4-up center-pulse row (mono) from `owner.pulse` | Component | P1 |
| 9 | Owner `todaySessions` w/ teacherName+enrolledCount; live-now amber (`startsAt<=serverTime<endsAt`) | Component | P1 |
| 10 | Owner needsAttention card (unassigned/at-risk/**storage capacity `percentUsed*100`, amber-on-approaching**/pendingInvites); NO Q&A; NO plan/seat; `NeedsAttentionList` NOT mounted (no 2nd fetch) | Component | **P0** |
| 11 | Owner trilogy | Component | P1 |
| 12 | Student greeting + week-strip glance + Due-soon(countdown+deep-link)/Recent-feedback/My-questions | Component | **P0** |
| 13 | Student read-only — no management actions, **no peer/classmate/class-average data**; disclaimer | Component | **P0** |
| 14 | Student trilogy (encouraging empty tone) | Component | P1 |
| 15 | s62 welcome renders when `localStorage['dashboard.student.welcomed:{userId}']` ABSENT | Component | P1 |
| 16 | Dismiss sets flag → never again; flag SET → hidden; **all-empty+flag-SET → NO welcome (negative, empty-inference forbidden)** | Component | **P0** |
| 17 | Responsive scope: no bottom-tab-bar mount (s82/s74 absent → FU-8-1-C) | Component | P3 |
| 18 | Net-new `dashboard.*` keys exist in en + vi (parity) | Module/i18n | P1 |
| 19 | Contract co-finalize (PROVISIONAL strip + codegen additive) | — | (dev task, `tsc -b`) |
| 20 | **TEST-FE-6 role-branch assert-ABSENCE** (student payload → only student cards, teacher/owner ABSENT from DOM; teacher; owner+admin both → OwnerDashboard); serverTime-driven times vs injected `meta.serverTime`; axe clean per dashboard; i18n en+vi | Component | **P0** |

### D13 gaps to bake into fixtures (rendered-WITHOUT, no fabrication)
- at-risk item: no `pendingCount`; question rail item: no `className` (only `classId`); due item: no `className`/`classId`; owner: no over-capacity flag. Tests assert render of what SHIPS (assignment title/skill, question content + anchorExcerpt), never a fabricated class label.

### Generated artifacts (file plan)
1. `src/features/dashboard/api/__tests__/handlers.ts` — MSW fixtures + handlers, typed `components['schemas']['Dashboard*']` (valid TS = D13 drift guard). Not a test.
2. `src/features/dashboard/__tests__/DashboardRoute.test.tsx` — AC1,2,3,20 role-branch spine (**P0**). RED: `@/features/dashboard/DashboardRoute` missing.
3. `src/features/dashboard/api/__tests__/useDashboard.test.tsx` — AC3 single-fetch + `meta.serverTime` (P1). RED: `useDashboard`/`dashboardKeys` missing.
4. `src/features/dashboard/__tests__/TeacherDashboard.realDashboard.test.tsx` — AC4,5,6,7,20 (**P0**). RED: real dashboard + `DashboardWeekStrip` etc. missing. (New file — does NOT touch the shipped 2-4 `TeacherDashboard.test.tsx`.)
5. `src/features/dashboard/__tests__/OwnerDashboard.test.tsx` — AC8,9,10,11,20 (**P0**). RED: `OwnerDashboard` missing.
6. `src/features/dashboard/__tests__/StudentDashboard.test.tsx` — AC12,13,14,15,16,20 (**P0**). RED: real `StudentDashboard` body + `useStudentWelcome` missing.
7. `src/features/dashboard/__tests__/dashboard.i18n.test.ts` — AC18 key existence en+vi (P1). RED: `dashboard.*` keys absent.

### Red-phase confirmation
- Every `*.test.tsx` fails at import (missing module) → `tsc -b` + Vitest import failure. No `test.skip()`. Fixtures file compiles green today (drift guard). Each file carries a SEAMS header block enumerating the `data-testid`/role/i18n-key contract the dev must expose to turn it green ([[reference_atdd_red_convention]]).

## Step 4 — Generation + Red-Phase Verification

### Orchestration note (deviation from generic step-04)
The skill's generic step-04 assumes an **API-worker + E2E-worker + `test.skip()`** shape. That conflicts with this project's ratified convention (project-context + [[reference_atdd_red_convention]]): FE red = import-fail via `tsc -b`, no `test.skip()`; no E2E for business logic; backend frozen (no new API red tests). Per [[feedback_pragmatic_interpretation_of_spec_absolutes]], the project convention wins — resolved mode **sequential/direct**, generating **component** scaffolds that mirror the shipped `StaffListPage.test.tsx` harness.

### Generated files (7)
| File | ACs | RED mechanism | Verified |
|---|---|---|---|
| `…/api/__tests__/handlers.ts` | — (fixtures) | **compiles GREEN** (typed vs generated `Dashboard*` = D13 drift guard) | `tsc -b` clean ✅ |
| `…/__tests__/DashboardRoute.test.tsx` | 1,2,3,20 | compile-red: `DashboardRoute` (+`OwnerDashboard`) missing | TS2307 ✅ |
| `…/api/__tests__/useDashboard.test.tsx` | 3 | compile-red: `useDashboard`/`dashboardKeys` missing | TS2307 ✅ |
| `…/__tests__/TeacherDashboard.realDashboard.test.tsx` | 4,5,6,7,20 | **runtime-red** (reworked in place); AC4 = regression guard | 10 fail / 1 pass ✅ |
| `…/__tests__/OwnerDashboard.test.tsx` | 8,9,10,11,20 | compile-red: `OwnerDashboard` missing | TS2307 ✅ |
| `…/__tests__/StudentDashboard.test.tsx` | 12,13,14,15,16,20 | **runtime-red** (reworked in place) | (harness = student twin of teacher, verified) |
| `…/__tests__/dashboard.i18n.test.ts` | 18 | runtime-red: `dashboard.*` keys absent en+vi | 28 fail / 1 pass ✅ |

### Red-phase verification (ground truth)
- `npx tsc -b` — the ONLY dashboard errors are the 4 intended TS2307s (DashboardRoute, OwnerDashboard, useDashboard, dashboardKeys). `handlers.ts` compiles clean → the D13 drift guard is live.
- `npx vitest run dashboard.i18n.test.ts` → 28 failed (keys missing) / 1 passed (parity-symmetry, both locales empty). Right red reason.
- `npx vitest run TeacherDashboard.realDashboard.test.tsx` → 10 failed on missing behavior / 1 passed (AC4 onboarding-incomplete regression guard). Harness (providers + MSW + session/onboarding seeding) confirmed correct → goes green cleanly on implement.

### NOT red-tested (documented, by design)
- **AC17 responsive / s82-s74 absence** — P3, and "must-NOT-exist bottom-tab-bar" is a trivially-green scope assertion, not a meaningful red. → cover in **TA (post-dev)** or accept-by-scope.
- **AC19 contract co-finalization** — a dev codegen/marker-strip task; verified by `tsc -b`=0 + fixtures compiling vs generated shapes, not a runtime test.

### Branch caveat (not mine to fix)
The branch already has **pre-existing `tsc` errors from other in-flight work** (`@/features/people/EnrolmentPage`, `Question*`/`AskQuestionRequest` on `useQuestions`/`useQuestionActions`). Baseline `tsc -b` is NOT clean independent of 8-1b. My files add only the 4 intended dashboard TS2307s. Flag to whoever owns the enrolment/questions branches; the 8-1b green-phase dev will want a clean tree.

## Handoff → BMM dev-story
- Story: `_bmad-output/implementation-artifacts/8-1b-role-specific-dashboards-frontend.md`
- Turn red → green by implementing the SEAMS enumerated in each file's header block (testids / roles / i18n keys). Do NOT weaken the assertions to pass; expose the seams.
- After green: run **TA** (P2/P3 expansion, MSW fault injection, AC17) then **RV** (flake/hard-wait/hidden-assertion review) per WF-8.
