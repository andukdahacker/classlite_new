---
baseline_commit: 41b9fd961aab9c66c2e91955c59dbed29a4712ae
---

# Story 10.5: Teacher Day-One Guided Start (s53)

Status: ready-for-dev

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
**Then** the day-one condition derives from real data (teacher has zero classes — via the dashboard payload or `useClasses` teacher scope; dev picks the single source, no new endpoint),
**And** step 1 ("Profile set") reflects the **actual profile-completeness signal** (default) rather than a hard-coded `done`, so the "you're already 1/3 done" promise is never a lie on an account whose profile is incomplete. *(See Open Question — Ducdo may rule hard-coded-DONE if invite-accept guarantees a complete profile in our data model.)*
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
**Then** assert: day-one start renders when teacher has 0 classes; it does NOT render when the teacher has ≥1 class (negative); step 1 reflects the profile signal (both states); step 2 CTA opens the create-class dialog; step 3 is disabled; axe-zero; i18n key existence both locales. Keep assertions semantic (test-id/role/name/copy), no DOM snapshots.

## Tasks / Subtasks

- [ ] **Task 1 (AC1/AC2):** Build the day-one guided start in `RealTeacherDashboard` using `EmptyState tone='guided'` + step cards (reuse `FinishSetupCard`/`TaskChecklistItem` idiom). Done/active/disabled states per the mock.
- [ ] **Task 2 (AC3):** Derive the "0 classes" day-one condition (single source, no new endpoint) + the step-1 profile-completeness signal; wire step-2 CTA to the create-class dialog.
- [ ] **Task 3 (AC4):** Net-new `dashboard.teacher.dayOne.*` keys both locales; `STORY_10_5_KEYS` ratchet; ★ REVIEWER-MANDATORY VN; axe + a11y states.
- [ ] **Task 4 (AC5):** Inline Vitest + axe (render/negative/step-states/CTA); `tsc -b`=0, ESLint=0, `vitest` 0-regression, `i18n-parity` green.

## Dev Notes

- **Depends on 10.3** — `src/components/domain/EmptyState.tsx` (`tone='guided'`, suppressible chip/headline, `children`) must exist. If 10.3 is not yet merged, this story blocks.
- **Files:** `src/features/dashboard/RealTeacherDashboard.tsx` (host); reuse `src/features/dashboard/FinishSetupCard.tsx` + `components/` `TaskChecklistItem` idiom; `src/features/dashboard/components/StudentWelcome.tsx` is the student analogue (s62, shipped) — mirror its additive, gated shape but trigger on 0-classes not a durable flag.
- **Mock-correct steps** (Sally, party-mode): Profile(done) / Create class(active CTA) / Invite students(disabled). The 10.3 draft's create/build/assign sequence was wrong and is corrected here.
- **UX:** `docs/classlite-entry/06b-empty-states.html` s53@5695 (page-head `<h1>Welcome to ClassLite, {name}</h1>` with accent on the name; step cards grid with DONE/active/disabled). `ux-design-specification.md` §6.4 "guided first-run."
- **Stack guardrails** (project-context.md): React 19, strict TS, Tailwind + `--cl-*` tokens, no `t()` inside `EmptyState` (strings passed in), no `new Date()` in render (TS-6), component-tier FW-7, `tsc -b` gate.
- **WF-7/WF-3:** all imports in `classlite-web/`; no `api.yaml`/`.sql` change; `codegen.sh` NOT run.

## Open Questions

- **Step 1 "Profile set" — DONE unconditional vs read the profile-completeness flag?** (Sally → Ducdo). AC3 defaults to **flag-driven** (truthful on every account). If invite-accept guarantees a complete profile in our data model, Ducdo may rule hard-coded-DONE to keep the day-one dopamine. **Resolve at dev pickup or first review.**
- **Day-one data source:** is "0 classes" available in the existing `/api/dashboard` teacher payload, or does the dev read `useClasses(teacher scope)`? No new endpoint either way — dev picks the cheaper existing signal.

## Definition of Done

- [ ] Day-one guided start renders for a 0-class teacher, hides at ≥1 class; steps Profile(done)/Create(active CTA)/Invite(disabled) per mock; additive to onboarding (AC1/AC2).
- [ ] Day-one condition + step-1 state derived from real signals (AC3); Open Questions resolved or explicitly deferred with Ducdo sign-off.
- [ ] `dashboard.teacher.dayOne.*` both locales + `STORY_10_5_KEYS` wired; prose ★ REVIEWER-MANDATORY VN; axe-zero; a11y states non-colour-only (AC4).
- [ ] Inline tests incl. the ≥1-class negative + step-state assertions (AC5); gates green (`tsc -b`, ESLint, `vitest` 0-regression, `i18n-parity`).
- [ ] Completion-notes sibling created per `bmad-story-conventions.md`.

## Out of Scope

- The `EmptyState`/`GhostedChartFrame` components themselves — **Story 10.3** (this story consumes them).
- s62 Student day-one — already shipped (`StudentWelcome`), re-platformed in 10.3.
- Build-exercise / assign-grade onboarding beyond day-one (week-one activation) — not a day-one step; future activation/onboarding work.
- Any backend signal for "teaching readiness" — derive from existing data only.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-10-07 | Story created (backlog → ready-for-dev) by SPLIT from Story 10.3 at party-mode pre-dev review (John/Sally; Ducdo "apply all"). s53 reframed from empty-state to activation surface. Steps corrected to the mock (Profile-done/Create-active/Invite-disabled). Depends on 10.3's `EmptyState`. ★ REVIEWER-MANDATORY VN on net-new prose. Open: step-1 DONE-vs-flag (Sally→Ducdo). baseline 41b9fd9. | Amelia (/bmad-party-mode) |

## Dev Agent Record

_Implementation record → sibling `10-5-teacher-day-one-completion-notes.md` per `docs/bmad-story-conventions.md`. Create at first dev pickup._

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
