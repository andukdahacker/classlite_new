# Story 10-5: Completion Notes

_Implementation record for [`10-5-teacher-day-one.md`](./10-5-teacher-day-one.md). Status: review._

## Dev Agent Record

### Debug Log

- **`/api/classes` is a SECOND fetch on the teacher dashboard.** Pre-existing teacher-dashboard tests mock only `/api/dashboard`. Verified the new `useClasses` call degrades safely under `onUnhandledRequest:'error'`: when `/api/classes` is absent the query errors → `isDayOne` false → the normal dashboard renders (existing assertions unaffected). In `TeacherDashboard.realDashboard.test.tsx` the singleton session is never seeded, so `useSessionCenter()?.id` is null → `useClasses` is disabled → no request fires at all. Only `TeacherDashboard.test.tsx` seeds the singleton center, so those 3 done-state renders were given an explicit `teacherScopedClassesHandlers` (non-empty → stays in the normal-dashboard branch, deterministic).
- **Teacher scope is `teacher:<userId>`, not the literal `'teacher'`** the story prose used as shorthand — mirrored `ClassesPage.tsx:88` (`teacher:${session?.user?.id ?? 'self'}`). The create-class mutation invalidates `classesKeys.lists()` (a prefix), so creating the first class flips `isDayOne` off automatically.
- **EmptyState h2 suppression:** step-card titles render as `<p>` (not `<h3>`) so the guided surface stamps no heading beside the page-head `<h1>` (AC1) and avoids an axe `heading-order` h1→h3 skip. The AC2 test asserts specifically that no `level:2` heading exists inside the surface.
- Root-config LSP diagnostics (`components['schemas'][...]` "does not exist", implicit-any) are the known false-reds from the solution-style root tsconfig — the real gate `tsc -b` is clean (per [[reference_web_typecheck_gate_is_tsc_b]]).

### Completion Notes

Shipped the s53 teacher day-one guided start as a net-new activation surface on `RealTeacherDashboard`:

- **AC1/AC2** — `TeacherDayOneStart` (new) renders via `EmptyState tone='guided'` (headline suppressed; the page-head `<h1>` "Welcome to ClassLite, {name}" carries the message with the name as a trailing §6.4 italic accent). Three ordered step cards reusing the FinishSetupCard checklist idiom: **Profile set (done)** / **Create your first class (active + single live CTA)** / **Invite your students (locked, disabled CTA)**. Additive — the onboarding `FinishSetupCard` strip still renders in the day-one branch; the surface disappears at ≥1 class.
- **AC3** — Day-one trigger derives from `useClasses(centerId, 'teacher:<id>')` returning `[]` (NOT rail-emptiness; the dashboard payload has no class count). Step-1 done = `Boolean(user.fullName)`. Step-2 CTA opens the shipped `ClassFormDialog` (no new route); step 3 has no live handler.
- **AC4** — 14 net-new `dashboard.teacher.dayOne.*` keys in `en.json` + `vi.json`, enumerated in `STORY_10_5_KEYS` and wired into `i18n-parity-coverage.test.ts` (existence + interpolation-token + namespace guards). Each step state carries a text status badge (done/todo/active/locked) so states are not colour-only. `vitest-axe` zero violations in en + vi. **VN prose is ★ REVIEWER-MANDATORY** — the ratchet checks shape, not translation correctness.
- **AC5** — Inline Vitest (12 tests): renders at 0 classes, negative at ≥1 class (HTTP boundary mocked per TEST-FE-1), both `Boolean(fullName)` step-1 branches, step-2 CTA opens the dialog, step-3 disabled, axe-zero (en+vi), i18n existence both locales, page-head-carries-message + hides-at-≥1.

No deviations from spec. No API/DB/`.sql`/`api.yaml` change; `codegen.sh` NOT run (WF-3/WF-7).

### Implementation Plan (summary)

1. Recon: EmptyState `tone='guided'` contract, StudentWelcome analogue, FinishSetupCard idiom, `useClasses`/`ClassFormDialog` barrel, i18n parity ratchet convention, MSW `onUnhandledRequest:'error'` blast radius.
2. RED: authored `TeacherDashboard.dayOne.test.tsx` (12 tests) → import/behavior failure; confirmed `tsc -b` baseline otherwise clean.
3. GREEN: `classListHandlers` test helper · `STORY_10_5_KEYS` module · `TeacherDayOneStart` component · `RealTeacherDashboard` wiring (useClasses + day-one branch + create-class dialog state) · 14 i18n keys both locales · parity-test describe block.
4. Honesty patch: explicit `teacherScopedClassesHandlers` on the 3 singleton-seeded done-state renders in `TeacherDashboard.test.tsx`.
5. Gates: `tsc -b`=0 · ESLint=0 · targeted + full vitest · i18n-parity green.

## File List

### Added

- `classlite-web/src/features/dashboard/components/TeacherDayOneStart.tsx` — the s53 guided 3-step start (EmptyState `tone='guided'` + step cards).
- `classlite-web/src/features/dashboard/__tests__/TeacherDashboard.dayOne.test.tsx` — inline Vitest + axe suite (AC1–AC5).
- `classlite-web/src/features/dashboard/__tests__/dayOneI18nKeys.ts` — `STORY_10_5_KEYS` ratchet (net-new key enumeration).
- `_bmad-output/implementation-artifacts/10-5-teacher-day-one-completion-notes.md` — this file.

### Modified

- `classlite-web/src/features/dashboard/RealTeacherDashboard.tsx` — `useClasses` day-one trigger + guided-start branch + create-class dialog state.
- `classlite-web/src/locales/en.json` — 14 `dashboard.teacher.dayOne.*` keys.
- `classlite-web/src/locales/vi.json` — 14 `dashboard.teacher.dayOne.*` keys (VN).
- `classlite-web/src/features/classes/api/__tests__/handlers.ts` — `classListHandlers(list)` parametrized MSW helper.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — Story 10.5 parity/interpolation/namespace describe block.
- `classlite-web/src/features/dashboard/__tests__/TeacherDashboard.test.tsx` — mock the new `/api/classes` fetch on the 3 done-state renders.

### Deleted

_None._
