---
baseline_commit: 41b9fd961aab9c66c2e91955c59dbed29a4712ae
---

# Story 10.5: Teacher Day-One Guided Start (s53)

Status: done

## Story

As a **teacher logging into ClassLite for the first time with no classes yet**,
I want **a guided first-step dashboard that shows me exactly what to do next and how far along I already am**,
so that **a brand-new account doesn't greet me with a dead, empty dashboard — it hands me momentum.**

## Context

**Split out of Story 10.3 (party-mode 2026-10-07; John + Sally).** s53 was originally folded into the Empty States story, but it is not an empty state — it is a net-new **activation surface**: a 3-step progress funnel with done-states, new copy, and new interaction logic. An empty state says "there's nothing here, here's how to add something." s53 says "here's how to succeed, step by step, with progress tracking." It carried the only net-new behavior in a story otherwise defined as "change nothing the user sees," and it had open design questions. So it gets its own story, its own risk framing, and a UX pass on the steps.

**Depends on Story 10.3** — this surface is built with the `EmptyState` component (`tone='guided'`, `children` slot, suppressible headline) that 10.3 ships. Do 10.3 first; 10-5 is a consumer of it.

Today (recon): the teacher dashboard (`src/features/dashboard/RealTeacherDashboard.tsx`) renders only **per-rail** empties (`needsGrading`/`unansweredQuestions`/`atRiskStudents` each `isEmpty`), plus the onboarding `WelcomeBackBanner` + `FinishSetupCard` machinery. There is **no whole-page day-one guided start**. A new teacher with zero classes sees three empty rails and a banner — the worst first impression in the app.

## Acceptance Criteria (BDD)

> **WF-8:** Pure frontend, no API/DB/RLS/auth — no risk-score ≥6 AC. ATDD tagged red NOT mandatory. Inline Vitest + `vitest-axe`. One residual ≥6: net-new VN prose correctness → ★ REVIEWER-MANDATORY (AC4).

### AC1 — The guided 3-step start renders on a teacher's empty day-one dashboard

**Given** a Teacher who is onboarded but has **no classes yet** (first-visit),
**When** `RealTeacherDashboard` detects the day-one condition,
**Then** a guided start renders via `EmptyState tone='guided'` (the message lives in the page-head `<h1>` + the step cards in `children`; the component's ghost-chip/headline are suppressed so there is no redundant second headline),
**And** the three steps are, in order, per the UX mock (`06b-empty-states.html` s53@5695) — **NOT create/build/assign**:
1. **Profile set** — shown **done** (green ✓, no CTA). Endowed-progress: the teacher is already 1/3 in because accepting the invite set up their profile.
2. **Create your first class** — the **active** card (accent border), carrying the single live primary CTA that opens the create-class dialog.
3. **Invite your students** — **disabled** (muted, no live CTA) until a class exists — the real next dependency after step 2.
**And** each step card has a mono `Step N` eyebrow, a title, a one-line description, and (step 2 only) a CTA,
**And** the sequence is logically honest: you cannot "assign & grade" at login-minute-one with zero students — build-exercise/assign-grade are week-one, not day-one, so they are deliberately NOT steps here.

### AC2 — Additive to onboarding, not a replacement

**Given** the existing onboarding machinery (`WelcomeBackBanner`, `FinishSetupCard`, `useChecklistState`),
**When** the day-one start renders,
**Then** it is **additive** — it does NOT remove or duplicate the onboarding banner/checklist; it renders when the teacher is past onboarding but has no teaching data yet,
**And** it reuses the `FinishSetupCard`/`TaskChecklistItem` card idiom where it fits (done / active / disabled states) rather than inventing a parallel one,
**And** it disappears once the teacher has ≥1 class (the normal dashboard with per-rail empties takes over).

### AC3 — Day-one condition + step-1 state are derived, not faked

**Given** the "no classes yet" trigger and the step states,
**When** computing them,
**Then** the day-one condition derives from `useClasses(centerId, 'teacher')` returning an empty list (`data.length === 0`) — **RULED Ducdo 2026-10-08**. It is **NOT** inferred from empty dashboard rails: the `/api/dashboard` teacher payload carries **no class count** (only `weekSessions`/`needsGrading`/`unansweredQuestions`/`atRiskStudents`), and empty grading/questions/at-risk rails do NOT imply zero classes — that is the `useStudentWelcome` empty-array anti-pattern. One extra lightweight teacher-scope query, no new endpoint.
**And** step 1 ("Profile set") is **done when `Boolean(user.fullName)` is true** — **RULED Ducdo 2026-10-08**. There is **no** profile-completeness flag in the data model; invite-accept requires a non-empty `fullName` (`classlite-api/internal/service/auth_invite.go:120`, 422 otherwise) so it is provably true for any teacher who reaches the dashboard, while the guard stays honest if a future flow ever creates a nameless teacher. Do **NOT** build a new completeness signal (barred by Out of Scope).
**And** step 2's CTA wires to the existing create-class dialog (not a new route); step 3 stays disabled with no live handler until a class exists.

### AC4 — i18n + a11y

**Given** the net-new copy,
**When** shipping,
**Then** all strings are net-new i18n keys `dashboard.teacher.dayOne.*` (title + per-step title/description/cta/eyebrow) in BOTH `en.json` + `vi.json`, added to a `STORY_10_5_KEYS` ratchet array wired into `i18n-parity-coverage.test.ts`,
**And** the prose is flagged **★ REVIEWER-MANDATORY (VN-fluent)** — the parity ratchet checks existence/token-shape only, never translation correctness,
**And** `vitest-axe` reports zero violations; the step progression is announced accessibly (done/active/disabled states are not colour-only — use text/`aria` per `TaskChecklistItem`); renders cleanly in en + vi (Vietnamese overflow).

### AC5 — Tests

**Given** the surface is net-new behavior,
**When** testing (inline, TEST-FE-*):
**Then** assert: day-one start renders when `useClasses(teacher)` returns `[]`; it does NOT render when the list has ≥1 class (negative — mock the HTTP boundary per TEST-FE-1, not the hook); step 1 is done with a non-empty `user.fullName` and NOT-done/active with an empty `fullName` (both states of the `Boolean(user.fullName)` guard); step 2 CTA opens the create-class dialog; step 3 is disabled; axe-zero; i18n key existence both locales. Keep assertions semantic (test-id/role/name/copy), no DOM snapshots.

## Tasks / Subtasks

- [x] **Task 1 (AC1/AC2):** Build the day-one guided start in `RealTeacherDashboard` using `EmptyState tone='guided'` + step cards (reuse `FinishSetupCard`/`TaskChecklistItem` idiom). Done/active/disabled states per the mock. → new `TeacherDayOneStart` component (step titles are `<p>`, not headings, so EmptyState's h2 stays suppressed beside the page-head `<h1>`).
- [x] **Task 2 (AC3):** Derive the "0 classes" day-one condition (single source, no new endpoint) + the step-1 profile-completeness signal; wire step-2 CTA to the create-class dialog. → `useClasses(centerId, 'teacher:<id>')` empty · `Boolean(user.fullName)` · step-2 CTA opens `ClassFormDialog`.
- [x] **Task 3 (AC4):** Net-new `dashboard.teacher.dayOne.*` keys both locales; `STORY_10_5_KEYS` ratchet; ★ REVIEWER-MANDATORY VN; axe + a11y states. → 14 keys en+vi; ratchet + namespace guard wired into `i18n-parity-coverage.test.ts`; text status badges (not colour-only).
- [x] **Task 4 (AC5):** Inline Vitest + axe (render/negative/step-states/CTA); `tsc -b`=0, ESLint=0, `vitest` 0-regression, `i18n-parity` green. → 12 day-one tests; full suite 3964 green (fixed the `noTrialMechanic` ratchet snag: `TeacherDayOneStartProps` → `TeacherDayOneProps` to avoid the `startpro` substring).

## Dev Notes

- **Depends on 10.3** — `src/components/domain/EmptyState.tsx` (`tone='guided'`, suppressible chip/headline, `children`) must exist. If 10.3 is not yet merged, this story blocks.
- **Files:** `src/features/dashboard/RealTeacherDashboard.tsx` (host); reuse `src/features/dashboard/FinishSetupCard.tsx` + `components/` `TaskChecklistItem` idiom; `src/features/dashboard/components/StudentWelcome.tsx` is the student analogue (s62, shipped) — mirror its additive, gated shape but trigger on 0-classes not a durable flag.
- **Mock-correct steps** (Sally, party-mode): Profile(done) / Create class(active CTA) / Invite students(disabled). The 10.3 draft's create/build/assign sequence was wrong and is corrected here.
- **Resolved signals (RULED Ducdo 2026-10-08):**
  - **Day-one trigger** = `useClasses(centerId, 'teacher')` → `data.length === 0`. Import `useClasses` from `@/features/classes/api/useClasses` (barrel per TS-7); `scope='teacher'`; `centerId` from `useSessionCenter()`. The teacher dashboard currently makes exactly one fetch (`useDashboard`) — this adds a second, deliberately (60s staleTime, teacher-own payload). Verified: `DashboardTeacher` in `src/lib/api/client.ts:3290` has no class-count field, so rail-emptiness is NOT a valid proxy.
  - **Step-1 done** = `Boolean(user.fullName)` where `user = useSessionUser()`. No new completeness signal. `RealTeacherDashboard` already reads `useSessionUser()` (line 50) and `useSessionCenter()` (line 51), so both signals are one import away.
- **UX:** `docs/classlite-entry/06b-empty-states.html` s53@5695 (page-head `<h1>Welcome to ClassLite, {name}</h1>` with accent on the name; step cards grid with DONE/active/disabled). `ux-design-specification.md` §6.4 "guided first-run."
- **Stack guardrails** (project-context.md): React 19, strict TS, Tailwind + `--cl-*` tokens, no `t()` inside `EmptyState` (strings passed in), no `new Date()` in render (TS-6), component-tier FW-7, `tsc -b` gate.
- **WF-7/WF-3:** all imports in `classlite-web/`; no `api.yaml`/`.sql` change; `codegen.sh` NOT run.

## Open Questions

_Both resolved by Ducdo 2026-10-08 (Amelia /bmad-create-story 10-5, evidence-backed). No open questions remain._

- ~~**Step 1 "Profile set" — DONE unconditional vs read the profile-completeness flag?**~~ **RESOLVED → `Boolean(user.fullName)` guard.** No completeness flag exists in the data model; invite-accept requires a non-empty `fullName` (`auth_invite.go:120`). See AC3 / Dev Notes.
- ~~**Day-one data source** — dashboard payload vs `useClasses`?~~ **RESOLVED → `useClasses(centerId, 'teacher')` empty list.** The `/api/dashboard` teacher payload carries no class count; rail-emptiness is not a valid proxy. See AC3 / Dev Notes.

## Definition of Done

- [x] Day-one guided start renders for a 0-class teacher, hides at ≥1 class; steps Profile(done)/Create(active CTA)/Invite(disabled) per mock; additive to onboarding (AC1/AC2).
- [x] Day-one condition (`useClasses` teacher empty) + step-1 state (`Boolean(user.fullName)`) derived from real signals (AC3). ✅ Open Questions resolved (Ducdo 2026-10-08).
- [x] `dashboard.teacher.dayOne.*` both locales + `STORY_10_5_KEYS` wired; prose ★ REVIEWER-MANDATORY VN; axe-zero; a11y states non-colour-only (AC4).
- [x] Inline tests incl. the ≥1-class negative + step-state assertions (AC5); gates green (`tsc -b`, ESLint, `vitest` 0-regression, `i18n-parity`).
- [x] Completion-notes sibling created per `bmad-story-conventions.md`.

## Out of Scope

- The `EmptyState`/`GhostedChartFrame` components themselves — **Story 10.3** (this story consumes them).
- s62 Student day-one — already shipped (`StudentWelcome`), re-platformed in 10.3.
- Build-exercise / assign-grade onboarding beyond day-one (week-one activation) — not a day-one step; future activation/onboarding work.
- Any backend signal for "teaching readiness" — derive from existing data only.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-10-09 | CODE-REVIEW (review → done) via /bmad-code-review 10-5. 3 adversarial layers; Auditor confirmed AC1–AC5 + all constraints MET + all 14 VN strings pass ★ REVIEWER-MANDATORY. Triage 1 decision / 1 patch / 3 defer / 5 dismissed. Decision (classesQuery.isError unhandled → silent empty-rails dead-end) RESOLVED Ducdo → Option 1: added a scoped `classesQuery.isError` inline `DashboardErrorAlert` branch (retry re-issues only the classes fetch) + an error-state test; removed a dead `locale` test param. Gates GREEN: `tsc -b`=0 · ESLint=0 · targeted vitest 1095 green (incl. new error test). 3 Low defers → `deferred-work.md` (centerId-null suppression + dead guard · stale-cache flash · empty-displayName email/comma). | Amelia (/bmad-code-review) |
| 2026-10-08 | IMPLEMENTED (ready-for-dev → review). `TeacherDayOneStart` component (EmptyState `tone='guided'` + 3 step cards done/active/locked) + `RealTeacherDashboard` day-one branch (`useClasses` teacher-empty trigger, `Boolean(user.fullName)` step-1, step-2 CTA → `ClassFormDialog`, additive onboarding strip). 14 net-new `dashboard.teacher.dayOne.*` keys en+vi + `STORY_10_5_KEYS` ratchet. 12 inline Vitest + axe. Gates GREEN: `tsc -b`=0 · ESLint=0 · full vitest 3964 green · i18n-parity green. Fixed the `noTrialMechanic` AC10 ratchet (renamed `TeacherDayOneStartProps`→`TeacherDayOneProps` — the old name contained the forbidden `startpro` substring). Impl record → sibling `10-5-teacher-day-one-completion-notes.md`. | Amelia (/bmad-dev-story 10-5) |
| 2026-10-08 | Open Questions RESOLVED (Ducdo, evidence-backed). Step-1 state = `Boolean(user.fullName)` guard (no completeness flag exists; invite-accept guarantees a name). Day-one trigger = `useClasses(centerId,'teacher')` empty list (dashboard payload has no class count; rail-emptiness rejected as the `useStudentWelcome` anti-pattern). AC3/AC5/Dev Notes updated; dependency 10.3 confirmed `done` + `EmptyState tone='guided'` API verified shipped. Story unblocked. | Amelia (/bmad-create-story 10-5) |
| 2026-10-07 | Story created (backlog → ready-for-dev) by SPLIT from Story 10.3 at party-mode pre-dev review (John/Sally; Ducdo "apply all"). s53 reframed from empty-state to activation surface. Steps corrected to the mock (Profile-done/Create-active/Invite-disabled). Depends on 10.3's `EmptyState`. ★ REVIEWER-MANDATORY VN on net-new prose. Open: step-1 DONE-vs-flag (Sally→Ducdo). baseline 41b9fd9. | Amelia (/bmad-party-mode) |

## Dev Agent Record

_Implementation record → sibling [`10-5-teacher-day-one-completion-notes.md`](./10-5-teacher-day-one-completion-notes.md) per `docs/bmad-story-conventions.md`._

### Agent Model Used

claude-opus-4-8[1m] (Amelia / bmad-dev-story)

### Debug Log References

See sibling completion-notes → Debug Log.

### Completion Notes List

See sibling completion-notes → Completion Notes.

### File List

See sibling completion-notes → File List (3 added incl. this record, 6 modified).

## Review Findings (/bmad-code-review 10-5 — 2026-10-09, Amelia)

_3 adversarial layers (Blind Hunter / Edge Case Hunter / Acceptance Auditor). Auditor confirmed AC1–AC5 + all Dev-Notes/Out-of-Scope constraints MET; all 14 VN strings pass ★ REVIEWER-MANDATORY (fluent, correct, consistent "học viên"). Triage: 1 decision-needed · 1 patch · 3 defer · 5 dismissed._

### Decision needed

- [x] [Review][Decision] `classesQuery.isError` is unhandled — **RESOLVED Ducdo 2026-10-09 → Option 1 (scoped inline error)**. Reclassified to a patch below. _(Blind + Edge, Medium)_

### Patches

- [x] [Review][Patch] Scoped inline error for `classesQuery.isError` in the day-one region [`classlite-web/src/features/dashboard/RealTeacherDashboard.tsx:76-90`] — **APPLIED**. Added a `classesQuery.isError` branch after the main error gate that returns the inline `DashboardErrorAlert` with `onRetry={classesQuery.refetch}` (scoped retry re-issues ONLY the classes fetch; the common no-error path is untouched). Covered by a new error-state test (`surfaces a scoped inline retry …`). _(Blind + Edge, Medium)_
- [x] [Review][Patch] Dead `locale` param in `renderDayOne` test helper [`classlite-web/src/features/dashboard/__tests__/TeacherDashboard.dayOne.test.tsx`] — **APPLIED**. Removed the unused `locale?` opt (`classes` made optional; `classesError?` added for the new error test); the axe test's call no longer passes `locale`, its in-body `changeLanguage('vi')` is retained. _(Auditor, Low)_

### Deferred

- [x] [Review][Defer] `centerId === null` suppresses day-one + dead `centerId !== null` guard [`classlite-web/src/features/dashboard/RealTeacherDashboard.tsx:50-57,104`] — deferred, theoretical: when `centerId` is null `useClasses` is `enabled:false`, so a 0-class teacher with an unresolved center silently gets the normal dashboard; corollary the `createClassOpen && centerId !== null` guard inside the `isDayOne` branch is effectively dead (data!=null already implies centerId truthy). A teacher reaching this dashboard always has a resolved center in practice. _(Edge, Low)_
- [x] [Review][Defer] Stale empty-classes cache flashes day-one for an established teacher [`classlite-web/src/features/dashboard/RealTeacherDashboard.tsx:61,75`] — deferred, low-frequency transient: a cached `[]` list past the 60s staleTime + a class gained on another device → day-one renders then flips to the normal dashboard when the background refetch returns. Bounded by staleTime; cosmetic flash. _(Edge, Low)_
- [x] [Review][Defer] Empty `displayName` → email-as-name accent / dangling greeting comma [`classlite-web/src/features/dashboard/RealTeacherDashboard.tsx:69,86-89`] — deferred, effectively unreachable: when `user.fullName` is empty the greeting accent falls back to the raw `user.email` (and if both empty, "Welcome to ClassLite," renders a trailing comma + empty span). Per AC3 invite-accept guarantees a non-empty `fullName` for any teacher reaching the dashboard, so this is only hit by the synthetic `fullName:''` test. Cheap fix if revisited: gate the accent span on a real name. _(Blind + Edge, Low)_

### Dismissed (noise / false positive / ratified)

- `ClassFormDialog` "yanked mid-flow" on branch-flip — FALSE POSITIVE: `ClassFormDialog.tsx:159` calls `onClose()` itself after a successful create, so the dialog self-closes before the invalidation flips the branch. _(Blind)_
- Hardcoded `bg-white` / `emerald-100/700` "breaks `--cl-*` tokens" — FALSE POSITIVE: mirrors `FinishSetupCard.tsx:87,157`, the exact sibling idiom the story mandates reusing. _(Blind)_
- Second `useClasses` fetch "pulls the full list to compute `length===0`" — RATIFIED by Ducdo 2026-10-08 ("one extra lightweight teacher-scope query, no new endpoint"). _(Blind)_
- Spec literal scope `'teacher'` vs code `teacher:${id}` — code is correct (bare `'teacher'` is invalid `ClassListScope`); spec-text imprecision only, no code defect. _(Auditor)_
- `StepCard` vs literal `TaskChecklistItem` reuse — AC2 hedges ("where it fits … rather than inventing a parallel one") and `FinishSetupCard` still renders alongside; defensible judgment call. _(Auditor)_
