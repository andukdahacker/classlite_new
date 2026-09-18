# Story 8-1b: Completion Notes

_Implementation record for [`8-1b-role-specific-dashboards-frontend.md`](./8-1b-role-specific-dashboards-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **Pre-flight** ([[feedback_check_prior_story_artifacts_before_generating]]): a full ATDD red-phase scaffold already existed on the branch (7 files + checklist). Turned red → green by exposing the seams each test declares — assertions never weakened.
- **Stale LSP noise**: the editor's inline TS diagnostics repeatedly reported the generated `Dashboard*` / `Question*` schemas as "does not exist" on the 2900-line `client.ts`. Ground truth is `tsc -b` (clean throughout). The ATDD checklist's "pre-existing branch tsc errors" note was the same stale-LSP artifact — the real build has none.
- **Harness impedance (2 real bugs, fixed)**: the role-dashboard test harnesses (DashboardRoute/Owner/Student) seed the session on the **module-singleton** `queryClient` (the `useRole`/StaffListPage convention), but my dashboards initially read `useAuth`/`useCurrentCenter` which use the **context** client → teacher gate saw a null center (→ banner instead of rails) and the student welcome saw a null userId. Fix: added `useSessionUser()` / `useSessionCenter()` to `useRole.ts` (singleton-sourced, mirroring `useRole`); the role dashboards read session-derived data from them. In production context === singleton, so behavior is unchanged; the fix only realigns the test-harness read path.
- **Role-testid timing**: initially put `owner-/student-/teacher-dashboard` testids on the loading/error shells too, so `findByTestId(role)` resolved during the skeleton phase and the synchronous rail assertions that follow raced. Fix: the role testid marks the **loaded** content only (skeleton → `dashboard-skeleton`, error → `role="alert"`).

### Completion Notes

- **All 20 ACs satisfied.** 179/179 dashboard tests green; full web suite 3220→ green (0 regressions); `tsc -b` = 0; ESLint clean; Go build clean.
- **D2 ghost-preview retirement + checklist-strip (RULED Ducdo 2026-09-16).** Onboarding-COMPLETE (`currentStep === 'done'` + persona) now renders the real s06 dashboard (`RealTeacherDashboard`) in place of the Epic-2 persona-preview bodies (`SampleDashboardPreview`/`FirstAIGradeCard`/`*DashboardBody`), per the D2 ruling ("the real dashboard with UX-1 empty states, not the ghost preview"). The **FinishSetupCard checklist is KEPT as a secondary strip** below the real dashboard (Ducdo ruling): `TeacherDashboard` builds the `ChecklistCtx` and hands it to `RealTeacherDashboard`, which renders `<FinishSetupCard>` after the rails/disclaimer. FinishSetupCard self-hides when snoozed or when the center is absent, so the strip only shows while setup remains. The ghost-preview value cards (`SampleDashboardPreview`/`FirstAIGradeCard`/`YourClassesRow`) are gone; those components remain in the repo with their own stories/tests (D2 "do not delete onboarding code"). Covered by two shipped-test cases (coexist when not snoozed · suppressed when snoozed).
- **Shipped-test consolidation.** `TeacherDashboard.test.tsx` (Story 2-4) asserted the ghost-preview bodies on `done`; those cells (Cell 5, 6a/6b/6c, the two persona mutex tests, the 9-render cell-5/6 axe matrix, and the done-state welcome-heading) were retired — the done→real-dashboard behavior is now owned by the new `TeacherDashboard.realDashboard.test.tsx`. Re-added two cases for the checklist strip (coexists when not snoozed · suppressed when snoozed). Preserved: the onboarding-incomplete shell cells (2/3/4/7), banner regression baseline, center-durability resume-routing, welcome-heading (retargeted to the real dashboard), and axe on the incomplete shell (en+vi).
- **D13 contract co-finalized.** Stripped the PROVISIONAL markers from the `/api/dashboard` block + `Dashboard*` schemas in `api.yaml`; re-ran `scripts/codegen.sh`. The `client.ts` diff is **comment-only** (the `@description` JSDoc text) — no shape change, no atomic-commit needed (WF-4). sqlc regen was a no-op. No Go logic touched.
- **D13 4 gaps rendered-WITHOUT** (no fabrication): at-risk `pendingCount`, question-rail `className`, due-item `className`/`classId`, owner over-capacity — all absent from the wire and not synthesized. Whether to ADD any is a backend follow-up (code-review decision-needed, mirrors 7-2b's DN pattern).
- **Week-strip tz display.** Day/time labels render in the center timezone via `Intl` (centralized in `lib/dashboardTime`). Column *membership* is not re-bucketed client-side (server-owned, D16); only the presentation of each instant is localized. The fuller purpose-built s82/s74 mobile trees are OUT (D14 → FU-8-1-C); dashboards ship responsive (44px targets, `overflow-x-auto`, no body overflow).
- **s62 welcome** gated on the durable positive per-user flag `localStorage['dashboard.student.welcomed:{userId}']` (D12) — never empty-array inference (negative test green).

### Implementation Plan (as executed)

1. API layer: `dashboardKeys`, `useDashboard` (`apiFetchWithMeta` — meta.serverTime), `lib/formatBytes`.
2. Shared lib/components: `lib/dashboardTime` (serverTime clock + zoned display), `DashboardStates` (skeleton + inline error), `DashboardWeekStrip`, `DashboardRailCard`, `StatTile`, `StorageCapacityCard`, `AtRiskRow`, `NeedsAttentionCard`, `DashboardTimeLabels`, `StudentWelcome` + `useStudentWelcome`.
3. Dashboards + route: `OwnerDashboard`, `RealTeacherDashboard`, `TeacherDashboard` split, `StudentDashboard` real body, `DashboardRoute` dispatcher (lazy per-role chunks); `routes.tsx` (retire `/student`, point `/dashboard` → `DashboardRoute`).
4. Singleton session hooks (`useSessionUser`/`useSessionCenter` in `useRole.ts`).
5. i18n (en + vi), D13 marker-strip + codegen, shipped-test consolidation, gates.

## File List

### Added
- `classlite-web/src/lib/formatBytes.ts`
- `classlite-web/src/features/dashboard/api/dashboardKeys.ts`
- `classlite-web/src/features/dashboard/api/useDashboard.ts`
- `classlite-web/src/features/dashboard/lib/dashboardTime.ts`
- `classlite-web/src/features/dashboard/DashboardRoute.tsx`
- `classlite-web/src/features/dashboard/OwnerDashboard.tsx`
- `classlite-web/src/features/dashboard/RealTeacherDashboard.tsx`
- `classlite-web/src/features/dashboard/hooks/useStudentWelcome.ts`
- `classlite-web/src/features/dashboard/components/DashboardStates.tsx`
- `classlite-web/src/features/dashboard/components/DashboardWeekStrip.tsx`
- `classlite-web/src/features/dashboard/components/DashboardRailCard.tsx`
- `classlite-web/src/features/dashboard/components/StatTile.tsx`
- `classlite-web/src/features/dashboard/components/StorageCapacityCard.tsx`
- `classlite-web/src/features/dashboard/components/AtRiskRow.tsx`
- `classlite-web/src/features/dashboard/components/NeedsAttentionCard.tsx`
- `classlite-web/src/features/dashboard/components/DashboardTimeLabels.tsx`
- `classlite-web/src/features/dashboard/components/StudentWelcome.tsx`

### Modified
- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — D2 split: preserve onboarding-incomplete shell, delegate complete path to `RealTeacherDashboard`, drop persona-body dispatch.
- `classlite-web/src/features/dashboard/StudentDashboard.tsx` — replaced the 27-line placeholder with the real s29 body + s62 welcome.
- `classlite-web/src/hooks/useRole.ts` — added `useSessionUser` / `useSessionCenter` (singleton-sourced session slices).
- `classlite-web/src/routes.tsx` — retired `/student`; `/dashboard` now lazy-loads `DashboardRoute`.
- `classlite-web/src/locales/en.json` / `vi.json` — net-new `dashboard.{teacher,owner,student,weekStrip,atRisk.reason,capacity,welcome,time}.*` (parity green).
- `classlite-web/src/features/dashboard/__tests__/TeacherDashboard.test.tsx` — consolidated: retired ghost-preview done-cells (now owned by realDashboard.test), retargeted welcome-heading, singleton-seed session, incomplete-shell axe.
- `classlite-web/src/features/dashboard/api/__tests__/handlers.ts` — wire-color eslint-disable on the fixture hex.
- `classlite-api/api.yaml` — D13: stripped PROVISIONAL markers from the `/api/dashboard` block + `Dashboard*` schemas (comment-only).
- `classlite-web/src/lib/api/client.ts` — regenerated (comment-only `@description` diff).

### Deleted
- None (the `/student` route entry was removed from `routes.tsx`; no files deleted — D2 preserves the onboarding components).
