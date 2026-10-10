---
baseline_commit: 9087e33452632b31eef821fd388897cdf0aaf4b8
---

# Story 10.4: Error States

Status: done

## Story

As a **user (student / teacher / admin / owner)**,
I want **clear, actionable, i18n'd error states throughout the app, all built on one canonical component that follows the three-part what/why/what-to-do recovery pattern**,
so that **when something goes wrong, is locked, or is denied, I understand what happened, why, and what I can do — and the codebase stops carrying a dozen hand-rolled `ErrorAlert` boxes that drift apart.**

## Context & the one thing to understand first

**This is the error-states twin of Story 10.3.** Where 10.3 built the canonical `EmptyState` and re-platformed every empty surface onto it, 10.4 does the same for errors — plus it lands the five epic-enumerated error surfaces (s63–s67) and the storage-100% upload error, and fixes the one deferred chrome nit (the <44px `InboxRow` touch-target, D4 from 10.3).

The replacement is pre-announced: `src/test/fixtures/error-state-placeholder.tsx` (`ErrorStatePlaceholder`, imported by exactly 8 `components/domain/*.stories.tsx`) carries a docstring that says *"Pre-Epic-10 stand-in for the real `ErrorState` … ships in Epic 10 Story 10.4 … a find-replace swaps imports and this file is deleted … Epic 10's real `ErrorState` should subsume both consumers."* The component-inventory names it `ErrorState` (domain, tier-2, M): *"Generic error layout: icon + headline + human message + primary recovery action"* and lists it as the shared base for s63/s64/s67.

**4-agent recon verdict — most surfaces already ship functionally; 10.4 is consolidation + gap-fill + polish:**

| Surface | Verdict today | 10.4 action |
|---|---|---|
| Canonical `ErrorState` | **MISSING** — ~12 copy-pasted local `ErrorAlert`s, only `DashboardErrorAlert` shared | **Build + re-platform all (D1)** |
| s63 late penalty | `LatePenaltyBreakdown.tsx` SHIPPED (5.5b), two-part (what+why), clamp nit, no dedicated test | Verify + fix clamp + test (D4) |
| s64 hard-deadline lock | Lock **mechanism** SHIPPED (`useAttemptReadOnly` 1s tick); copy is timer-framed, no next-step | Add deadline-framed copy + extension next-step (D4) |
| s65 class-form validation | Inline per-field red + simultaneous errors SHIPPED; no summary banner / shared `InlineFieldError` / name-conflict / capacity-cap | Build `FormValidationBanner` + `InlineFieldError` + name-conflict + owner capacity check (D3) |
| s66 locked finalized exercise | **MISSING on FE** — backend lock ships (`locked`/`lockReason`/`lockedBy`, 409 `EXERCISE_LOCKED`); only generic Duplicate | Build clone-only locked UI; amend AC (D2) |
| s67 permission denied | `PermissionDenied.tsx` SHIPPED + fully route-wired; shows required role but NOT current role | Add current-role line (D4) |
| storage-100% upload | `StorageFullBlock` SHIPPED (4.4b), role-split, blocks new only; no "View storage" CTA | Add "View storage" CTA (D4) |
| <44px `InboxRow` action | 10.3 D4 deferral | Fix touch-targets (D4) |

> **Honest value framing (mirror 10.3/John):** on the ~12 re-platformed query-error alerts and s63/s67 the end-user sees **no behavior change** (characterization guarantees it). D1's payoff is **engineering** — delete the placeholder, one error idiom to evolve, the three-part pattern enforced in one place. The genuinely new user-facing surfaces are s64 (deadline copy + next-step), s65 (summary banner + capacity/name validation), s66 (the locked-exercise screen that never shipped), storage ("View storage" CTA), and s67 (current-role line).

### Ducdo rulings (2026-10-09, /bmad-create-story 10-4)

- **D1 — FULL consolidation (10.3 D1 parity).** Build the canonical `ErrorState` (`components/domain/ErrorState.tsx`), swap the 8 placeholder-story imports + delete the fixture, AND re-platform **all ~12 ad-hoc local `ErrorAlert`s** onto it. Scope is the **inline `role="alert"` retry-banner idiom only** — the fullscreen orientation screens (`ErrorBoundary` `ErrorFallback`, `PermissionDenied`, `NotFound`) are a different shape and stay. Characterization-first per surface (baseline-green → re-platform → run-green); no copy/test-id/retry-behavior regression.
- **D2 — Build the clone-only s66 locked-exercise UI; amend the stale epic AC.** The FE locked-state UI was planned for Epic 5 but never shipped; the backend lock does ship. **"Unfinalize" was struck from FR-23 (D5) — clone-only** (`api.yaml:12749`). So 10.4 builds the read-only `ReadOnlyStrip` + "Locked" indicator + **Clone** (existing `useDuplicateExercise`) as the single sanctioned unlock path. The epic AC's two-path "Clone + Unfinalize" is amended to clone-only (pragmatic-interpretation convention; amend the AC, don't resurrect a struck feature).
- **D3 — s65: canonical components + client cap check, all FE.** Build `FormValidationBanner` (top-of-form enumerated summary) + `InlineFieldError` (shared per-field red idiom, reused by every form). Name-conflict → a **client-side** uniqueness check against the already-loaded class list (there is NO distinct server name-conflict code; create returns a generic 422). Capacity>plan-cap inline with an **Upgrade** link → **owner-gated** (the per-class cap lives only on owner-only `GET /api/billing` `limits.studentsPerClass`, and Upgrade is an owner action); the teacher path defers to the 9.2-armed server `PLAN_LIMIT_EXCEEDED` 409 → the existing global `PlanLimitExceededDialog` → **FU-10-4-CAPACITY-TEACHER**.
- **D4 — Epic-AC level; stub-or-omit recovery, defer rich flows.** The UX mocks are far richer than the epic ACs and lean on v1 features that do not exist (penalty-waiver approval, extension-request, grace-window timelines, the s67 "who has access" directory). Ship epic-AC content only; a recovery affordance is rendered **only where a shipped surface backs it** (else text-only guidance, no dead button — the `PermissionDenied` "Message Owner" no-op is a pre-existing tolerated case, not a licence for new ones). Defer the rich flows → FU-10-4-{WAIVER, EXTENSION, TIMELINE, S67-DIRECTORY}.

## Acceptance Criteria (BDD)

> **WF-8:** No risk-score ≥6 AC *for new-feature correctness* — pure frontend, consumes only existing API contracts (`codegen.sh` NOT run; WF-7 all imports in `classlite-web/`; no `api.yaml`/`.sql`/migration). ATDD tagged red-phase NOT mandatory. **The dominant risk is silent regression on the ~12 re-platformed `ErrorAlert`s + s63 (D1)** → mitigation is **characterization-first** (baseline-green → re-platform → run-green; AC12). The residual ≥6 is **VN-copy correctness** on the net-new error prose → ★ REVIEWER-MANDATORY (AC11). Honor **R52** (Storybook three-state rule) — the new domain stories carry `// storybook-rule: no-three-state`.

### AC1 — Canonical `ErrorState` component (component-inventory domain/M2; UX-DR16 three-part)

**Given** the ~12 copy-pasted `ErrorAlert`s and the `ErrorStatePlaceholder` stand-in,
**When** inspecting `src/components/domain/ErrorState.tsx`,
**Then** ONE presentational leaf covers the inline error idiom via a flat prop interface (NO discriminated union — mirrors `EmptyState`):

```ts
export interface ErrorStateProps {
  icon?: ReactNode          // optional glyph (ghosted); call site supplies AlertTriangle etc.
  message: string           // i18n-RESOLVED "what happened" — REQUIRED
  detail?: string           // i18n-RESOLVED "why" context line — optional (the three-part middle)
  retryLabel?: string       // i18n-RESOLVED; renders a retry Button only when paired with onRetry
  onRetry?: () => void
  action?: ReactNode        // optional "what to do next" CTA / escape (View storage, Go to Dashboard…)
  'data-testid'?: string
}
```

**And** it renders a `role="alert"` inline banner in the shipped idiom (`--cl-red`/`--cl-tint-red` or the neutral `DashboardErrorAlert` surface tokens — pick the red error idiom as canonical; a bordered rounded box, message `<p>`, optional `detail` `<p>`, a `retry` Button `variant="outline" size="sm"` when `onRetry`, and the optional `action` slot).
**And** it **never calls `t()` and never reads role** — all strings arrive i18n-resolved; role-dependent CTAs (owner "Upgrade" vs member "ask owner") are decided at the call site (UX-1/UX-3/TEST-FE-4). HTTP codes / stack traces are NEVER surfaced (UX-DR24).
**And** the three-part pattern maps to `message` (what) + `detail` (why) + `retry`/`action` (what-to-do); a transient fetch-retry alert legitimately uses `message`+`retry` only (its "why" is self-evident) — `detail` is required *in spirit* only for the designed error states (s63–s67, storage).
**And** `ErrorState.stories.tsx` ships the variants (RetryOnly, WithDetail, WithAction, WithIcon), every string `t()`-resolved, axe-zero, carrying `// storybook-rule: no-three-state`.

### AC2 — Full re-platform of the ad-hoc `ErrorAlert`s onto `ErrorState` (D1)

**Given** the inline query-error alerts enumerated below, **when** re-platformed, **then** each routes its error render through `ErrorState` with **no regression** to rendered copy, `role="alert"`, retry behavior (re-issues the TanStack Query `refetch`), or test-ids:

| File | Local component | Note |
|---|---|---|
| `features/dashboard/components/DashboardStates.tsx` | `DashboardErrorAlert` (shared by 3 dashboards + 3 analytics containers) | The one multi-consumer alert — re-platform FIRST as the oracle; it currently calls `t()` internally, so callers now resolve `messageKey`/`retryLabelKey` and pass strings |
| `features/classes/ClassesPage.tsx:388` | `ErrorAlert` | |
| `features/inbox/components/InboxStates.tsx:46` | `InboxErrorAlert` | keep `InboxFilterEmpty`/skeletons untouched |
| `features/archive/components/ArchiveStates.tsx:42` | `ArchiveErrorAlert` | |
| `features/assignments/AssignmentsListPage.tsx:135` | `ErrorAlert` | |
| `features/exercises/ExerciseLibraryPage.tsx:489` | `ErrorAlert` | |
| `features/people/StaffListPage.tsx:396` | `ErrorAlert` | |
| `features/people/components/StudentRosterView.tsx:560` | `ErrorAlert` | |
| `features/knowledge-hub/KnowledgeHubPage.tsx:580` | `ErrorAlert` | |
| `features/onboarding/OnboardingDonePage.tsx:88` | `ErrorAlert` | |
| `features/settings/RoomsTab.tsx:421` + `TermCalendarTab.tsx:718` | `ErrorAlert` + `SaveErrorAlert` | two variants: load-error + save-error (both inline) |

**And** the fullscreen orientation screens — `ErrorBoundary` `ErrorFallback`, `PermissionDenied`, `NotFound`, the router `RouterErrorFallback` — are **NOT** re-platformed (different `min-h-screen` orientation shape; D1 scope is the inline idiom).
**And** toast-based mutation errors (`sonner`) are **NOT** in scope.
**And** every re-platformed surface keeps its loading-skeleton and empty branches untouched (10.3 owns empties).

### AC3 — Swap and delete the placeholder (same PR)

**Given** `src/test/fixtures/error-state-placeholder.tsx` (`ErrorStatePlaceholder {message?, retryLabel?, onRetry?}`), imported by exactly 8 `components/domain/*.stories.tsx` (`MobileWritingSurface`, `WriteDocSurface`, `AnchoredQuestionCard`, `PageHead`, `InboxListShell`, `WritingGradingSurface`, `SpeakingGradingSurface`, `AnalyticsHomeShell`),
**When** 10.4 lands,
**Then** every import is swapped to `ErrorState` (map `{message, retryLabel, onRetry}` → `{message, retryLabel, onRetry}`), the fixture is **deleted**, and `npm run storybook:test:ci` stays green (each swapped story still exports a satisfying `Error` story; R52 is a name-set check).

### AC4 — s63 late-penalty math (verify + fix the clamp nit; D4)

**Given** `features/submission-review/components/LatePenaltyBreakdown.tsx` (shipped 5.5b: two-part — the FR-31 equation `submissionReview.grade.penaltyBreakdown` + the why `submissionReview.grade.penaltyExplainer`; neutral/never-red; gated on `isLate && appliedPenalty > 0`),
**When** 10.4 lands,
**Then** the component is confirmed to satisfy the s63 epic AC (math shown + why) and the displayed **penalty is clamped to the original band** so a large penalty can never render a false equation (today `penalty.toFixed(1)` is raw while only `final` is clamped — `original 1.0 − penalty 2.0 = final 0.0` is arithmetically false; clamp the displayed penalty to `min(penalty, original)` so the three shown numbers always re-sum).
**And** a dedicated `LatePenaltyBreakdown.test.tsx` is added covering: the exact FR-31 string, neutral tone (no red), the on-time absence, and the **clamped large-penalty** case.
**And** the penalty-waiver escape card (mock-only) is **deferred** → FU-10-4-WAIVER (no waiver-approval feature exists).

### AC5 — s64 hard-deadline locked submission (copy + next-step; D4)

**Given** the attempt read-only spine (`features/attempts/lib/attemptReadOnly.ts` + `hooks/useAttemptReadOnly.ts` — the hard-deadline lock + 1s re-lock tick + the inline `writing-readonly-banner`, all shipped),
**When** the read-only reason is `timeExpired` **and the cause is a passed hard deadline** (not a running timer),
**Then** the banner shows deadline-framed copy — net-new `attempt.readonly.deadlinePassed` ≈ "The deadline has passed — this submission is locked." (★ VN) — instead of the timer-framed "Time's up…",
**And** a single suggested next step is shown as text-level guidance — net-new `attempt.readonly.extensionHint` ≈ "Contact your teacher to request an extension." (★ VN) — rendered inside/under the banner; **no functional extension-request button** (no such flow exists; the extension-request flow defers → FU-10-4-EXTENSION).
**And** the shipped lock mechanism (editor disabled, autosave off, Submit hidden, flush-on-flip, focus-to-banner) is **preserved unchanged** — this AC is copy + a reason refinement, not a mechanism change. The existing `timeExpired`/`locked`/`submitted` reasons stay; the deadline framing is a presentation refinement keyed off the `hardDeadlineAt`-passed branch.

### AC6 — s65 class-creation validation (FormValidationBanner + InlineFieldError + name-conflict + owner capacity; D3)

**Given** `features/classes/components/ClassFormDialog.tsx` (RHF + `zodResolver`, per-field inline red already shipped, all errors simultaneous),
**When** inspecting the form's error surfaces,
**Then** a shared `src/components/domain/InlineFieldError.tsx` renders the per-field red idiom (`role="alert"`, `text-[color:var(--cl-red)]`, red-bordered input state) and the form uses it (replacing the ad-hoc inline `<p>`), and a server 422 `ValidationError` maps its `details.fields[]` → RHF `setError(field)` so field-targeted server errors surface inline,
**And** a `src/components/domain/FormValidationBanner.tsx` renders a top-of-form `role="alert"` summary enumerating the current errors (net-new `classes.form.validationBanner.title` with `{{count}}` ★ VN) when ≥1 error is present,
**And** a **client-side name-conflict** check against the already-loaded class list surfaces a field-targeted error (`classes.form.errors.nameConflict` ★ VN) — there is no distinct server code,
**And** for an **owner**, a **client-side** capacity check compares the entered capacity against `limits.studentsPerClass` from `useBillingSummary()` and, when exceeded, shows an inline field error with an **Upgrade** link reusing the billing seam (net-new `classes.form.errors.capacityOverPlan` with `{{cap}}`/`{{planName}}` ★ VN); for a **teacher** (no billing access) the capacity-cap path is NOT checked client-side and defers to the future-armed server 409 → the existing global `PlanLimitExceededDialog` (FU-10-4-CAPACITY-TEACHER).
**And** the existing 409 `PLAN_LIMIT_EXCEEDED` (classes-count hard-block) → global `PlanLimitExceededDialog` behavior is **preserved** (`ClassFormDialog.test.tsx:179-209`).

### AC7 — s66 locked finalized exercise (clone-only; D2)

**Given** the exercise editor (`features/exercises/ExerciseEditorPage.tsx`) and the shipped backend lock (exercise detail `locked: true` / `lockReason: "has_submissions"` / `lockedBy: ExerciseLock[]`; content edits return 409 `EXERCISE_LOCKED`; "Clone (POST /duplicate) is the sanctioned edit path"),
**When** a teacher opens an exercise whose `locked === true`,
**Then** the editor renders **read-only** with a `src/components/domain/ReadOnlyStrip.tsx` (net-new, domain/M3: "Locked" indicator + the three-part explainer — what: locked; why: grades finalized / has submissions; what-to-do: clone) and a single **Clone** unlock path wired to the existing `useDuplicateExercise` (→ opens the editable copy),
**And** the 409 `EXERCISE_LOCKED` on a racing write is mapped to the same read-only state (no raw 500/toast),
**And** net-new keys `exercises.locked.{indicator,strip.title,strip.body,clone.cta}` ship both locales (★ VN); copy follows the three-part pattern.
**And** **"Unfinalize" is NOT built** (struck from FR-23 D5 — clone-only); the epic AC is amended accordingly (Change Log). The rich audit-trail card (mock) defers → FU-10-4-TIMELINE.

### AC8 — s67 permission denied: complete the required+current+escape triad (D4)

**Given** `components/shared/PermissionDenied.tsx` (shipped, route-wired; shows required-role summary + section header + "Go to Dashboard" escape, but NOT the user's current role),
**When** the screen renders,
**Then** it additionally shows the **current role** for context — net-new `app.permissionDenied.currentRole` with `{{role}}` (★ VN), the role name resolved via existing role-name i18n (role read at the call site / via `useRole`, not hardcoded) — completing the epic AC's "required role + current role + escape" triad,
**And** the existing title / section header / body variants / required-role summary / "Message Owner" no-op stub / dashboard escape are **preserved unchanged**; the "who has access" directory card (mock) defers → FU-10-4-S67-DIRECTORY.

### AC9 — storage-100% upload error: add the "View storage" CTA (D4)

**Given** `features/knowledge-hub/components/UploadDialog.tsx` `StorageFullBlock` (shipped 4.4b: role-split body, blocks only new uploads, `kh-upload-storage-full`),
**When** the storage-full block renders,
**Then** it includes a **"View storage"** CTA linking to Settings → Storage (net-new `knowledgeHub.storage.full.viewStorageCta` ★ VN; the route is the existing Settings → Storage tab), satisfying the epic AC's three-part close (what: storage full; why: at plan limit; what-to-do: delete/upgrade **+ view storage**),
**And** the role-split owner/member body + new-uploads-only blocking are **preserved**; existing files stay accessible.

### AC10 — <44px `InboxRow` touch-targets (D4, from 10.3)

**Given** `components/domain/InboxRow.tsx:168,176` (primary action `size="xs"`, archive `size="icon-xs"` — both below the ≥44px floor; 10-1b deviation #5 deferred to 10.4),
**When** the row renders,
**Then** both row-action controls meet the ≥44px touch-target floor (TEST-UX-4) without breaking the shipped row layout/density, and a structural test asserts the target size,
**And** the shared 1d-4 chrome is edited in-place (not forked); existing `InboxRow` tests do not regress.

### AC11 — i18n parity ratchet (STORY_10_4_KEYS) + VN correctness

**Given** the net-new keys this story adds,
**When** wiring the ratchet,
**Then** `src/lib/test/story10_4Keys.ts` exports `STORY_10_4_KEYS: readonly string[]` — **exhaustive, net-new only** — imported into `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with a `describe('Story 10.4 i18n parity', …)` running `assertI18nParity` + `assertI18nInterpolationParity` + the closed-enumeration prefix ratchet (10-2/10-3 precedent),
**And** every net-new string exists in BOTH `en.json` + `vi.json` with matching `{{token}}` sets,
**And** the net-new **prose** copy (`attempt.readonly.deadlinePassed`, `attempt.readonly.extensionHint`, `exercises.locked.strip.body`, `classes.form.errors.capacityOverPlan`, `classes.form.errors.nameConflict`, `app.permissionDenied.currentRole`, and any other sentence-length string) is flagged **★ REVIEWER-MANDATORY (VN-fluent)** — the ratchet checks existence + token-shape, never translation correctness.

### AC12 — Characterization-first regression discipline + a11y + gates

**Given** D1 re-platforms ~12 shipped alerts + touches 5 shipped surfaces,
**When** executing,
**Then**:
- **Baseline-green gate:** run the full suite on `9087e33` and record it green before touching anything.
- **Re-platform discipline:** `DashboardErrorAlert` (the multi-consumer oracle) first; then run-green → re-platform each remaining alert → run-green. Keep assertions **semantic** (test-id / role / name / resolved copy), never DOM snapshots.
- **Three-state coverage** (TEST-FE-2) on any surface whose error branch is touched stays intact (loading/success/error).
- **a11y:** every new domain component (`ErrorState`, `FormValidationBanner`, `InlineFieldError`, `ReadOnlyStrip`) gets `vitest-axe` (en + vi render); decorative icons `aria-hidden`; `role="alert"` on error banners.
- **Gates:** `tsc -b`=0, ESLint=0, `vitest` 0-regression, `storybook:test:ci` green, `i18n-parity` green.

## Tasks / Subtasks

> Risk-ordered: prove `ErrorState` on the shared oracle before the fan-out, then the gap-fill surfaces.

- [x] **Task 0 (AC12):** Baseline-green — ran full suite on `9087e33`. Found 2 pre-existing failures in `DashboardRoute.test.tsx` (10-5 teacher day-one `/api/classes` fetch unmocked → `DashboardErrorAlert`); fixed per 10-3 pre-existing-gate precedent by adding `teacherScopedClassesHandlers`. Suite green (3965 pass).
- [x] **Task 1 (AC1):** Built `components/domain/ErrorState.tsx` (flat interface, `role="alert"`, dumb leaf — no `t()`/role, three-part `message`/`detail`/`retry`+`action`, red idiom) + `ErrorState.stories.tsx` (`// storybook-rule: no-three-state`) + `__tests__/ErrorState.test.tsx` (9 tests incl. axe en+vi). Green.
- [x] **Task 2 (AC2 oracle):** Re-platformed `DashboardErrorAlert` onto `ErrorState` — now a thin wrapper taking resolved strings; all 8 call sites (3 dashboards incl. teacher classes-error + 3 analytics containers) resolve keys via `t()` (added `useTranslation` to `AnalyticsHomeContainer`). Oracle green (dashboard+analytics 295/295); neutral→red token change broke no semantic assertion.
- [x] **Task 3 (AC2 fan-out):** Re-platformed the remaining local `ErrorAlert`s onto `ErrorState`: ClassesPage, AssignmentsListPage, ExerciseLibraryPage, StaffListPage, StudentRosterView (deleted private red-idiom fns; call sites already resolved strings); KnowledgeHubPage (preserved `kh-error` test-id); InboxErrorAlert + ArchiveErrorAlert (kept as named wrappers delegating to ErrorState, resolve own copy); RoomsTab + TermCalendarTab `ErrorAlert` (load) + `SaveErrorAlert` (classify-switch kept, render→ErrorState, `testId` preserved). **OnboardingDonePage EXCLUDED** — its `ErrorAlert` is an amber, focus-on-mount, `aria-live="assertive"`, disabled-aware, `persistent` orientation `<section>` (not the inline red retry-banner idiom); re-platforming would regress focus/assertive/disabled behaviors, so per D1 (inline-only) + pragmatic-interpretation it stays. `tsc -b`=0; 549 feature tests green (0 regressions).
- [x] **Task 4 (AC3):** Swapped all 8 `ErrorStatePlaceholder` story imports → `ErrorState` (MobileWritingSurface, WriteDocSurface, AnchoredQuestionCard, PageHead, InboxListShell, WritingGradingSurface, SpeakingGradingSurface, AnalyticsHomeShell); PageHead's prop-less usage given an explicit `message` (ErrorState.message is required). Deleted `src/test/fixtures/error-state-placeholder.tsx`. `tsc -b`=0. `storybook:test:ci` deferred to Task 13 gate.
- [x] **Task 5 (AC4):** s63 — clamped displayed penalty to `Math.min(appliedPenalty, original)` in `LatePenaltyBreakdown.tsx` so the equation always re-sums; added `LatePenaltyBreakdown.test.tsx` (5 tests: exact FR-31 string, muted/non-red tone, on-time absence, late-but-0 absence, clamped large-penalty re-sum). submission-review 87/87 green.
- [x] **Task 6 (AC5):** s64 — added net-new `attempt.readonly.deadlinePassed` + `attempt.readonly.extensionHint` (both locales ★ VN). New shared spine helper `readOnlyBannerCopy(reason, hardDeadlineAt, serverNowMs)` (in `attemptReadOnly.ts`, barrel-exported): a `timeExpired` reason caused by a passed hard deadline → deadline copy + extension hint; all other causes (timer/racing-write 409 with null deadline, submitted, locked) keep their key. Wired into all 3 shells (writing/speaking/quiz) with a text-level hint line (no functional extension button). Lock mechanism preserved (editor disabled / Submit hidden / flush-on-flip / focus-to-banner untouched). Tests: 6 spine-helper branches + 1 shell integration (deadline copy + hint, not timer copy, mechanism intact). 224 green across spine+3 shells; `tsc -b`=0.
- [x] **Task 7 (AC6):** s65 — built `components/domain/InlineFieldError.tsx` + `FormValidationBanner.tsx` (dumb leaves, axe-covered en+vi). `ClassFormDialog`: `Field` now uses `InlineFieldError`; top-of-form `FormValidationBanner` enumerates all live errors + the capacity nudge (`classes.form.validationBanner.title` {{count}}); client name-conflict (case-insensitive vs `existingNames`, excludes own name in edit) → `setError('name', nameConflict)`; owner-gated capacity>`limits.studentsPerClass` from `useBillingSummary` → inline `class-capacity-over-plan` + Upgrade `<Link>` to `/settings/billing/plans` (`capacityOverPlan` {{cap}}/{{planName}} + `capacityUpgradeCta`), blocks submit; teacher path has no inline cap (defers to server 409); 422 `ValidationError.details.fields[]`→`setError` (whitelisted targets). Preserved the 409 `PLAN_LIMIT_EXCEEDED`→global dialog. `planDisplayName` barrel-exported. 4 net-new keys both locales (★ VN). Tests: 5 new (owner inline+Upgrade+block · teacher no-inline · name-conflict · banner-count · 422 map) + 2 domain axe tests. classes suite 74/74; `tsc -b`=0.
- [x] **Task 8 (AC7):** s66 — built `components/domain/ReadOnlyStrip.tsx` (dumb locked-state leaf: Lock indicator + three-part explainer + action slot, amber/non-red, axe en+vi). `ExerciseEditorPage`: `locked===true` gate renders `ExerciseLockedView` (ReadOnlyStrip + Clone via `useDuplicateExercise`→navigate to editable copy; back link; NO editing surface mounted). `useExerciseAutosave`: a racing-write 409 `EXERCISE_LOCKED` invalidates the detail query → refetch flips `locked` → same read-only view (no reload-loop/toast/500). 4 net-new `exercises.locked.*` keys both locales (★ VN). **No Unfinalize** (D2/D5 struck). Tests: locked→strip+indicator+no-editor+no-unfinalize · Clone opens copy · parity. exercises 82/82; `tsc -b`=0.
- [x] **Task 9 (AC8):** s67 — added the current-role line to `PermissionDenied` (`app.permissionDenied.currentRole` {{role}}, role via `useRole`, label via `userPill.role.${role}`, omitted when null); everything else (title/section/body variants/required-summary/Message-Owner stub/dashboard escape) preserved. 2 net-new tests (triad present w/ role · omitted unauthenticated) + key added to parity list. 13/13 green. Who-has-access directory deferred → FU-10-4-S67-DIRECTORY.
- [x] **Task 10 (AC9):** storage — added an owner-gated "View storage" `<Link>` to `/settings?tab=storage` in `StorageFullBlock` (`knowledgeHub.storage.full.viewStorageCta`, both locales ★ VN). Owner-gated because Settings→Storage is owner-only + only the owner controls the plan (member body already says "ask your owner"). Role-split body + new-uploads-only blocking preserved. Tests: owner CTA present+href · teacher no-CTA. 9/9; `tsc -b`=0.
- [x] **Task 11 (AC10):** `InboxRow` — added `min-h-11 min-w-11` (44px) to both row-action controls in-place (min-height/width force the ≥44px tap target while the compact ghost/xs visual density is unchanged; TEST-UX-4). New `InboxRow.test.tsx` structural assertion (primary + archive + suppress-archive). inbox suite 73/73, no regression.
- [x] **Task 12 (AC11):** Built exhaustive `src/lib/test/story10_4Keys.ts` (12 net-new keys across attempt.readonly/classes.form/exercises.locked/app.permissionDenied/knowledgeHub.storage.full); wired a `describe('Story 10.4 i18n parity (master ratchet)')` into `i18n-parity-coverage.test.ts` (parity + interpolation parity + closed-enumeration prefix ratchet, 10.3/10.5 precedent). All keys ship in both en+vi (prose ★ REVIEWER-MANDATORY VN). coverage 1079 pass; `npm run i18n-parity` OK (2727 keys).
- [x] **Task 13 (AC12):** Final gates ALL GREEN — `tsc -b`=0 · ESLint=0 errors (5 pre-existing warnings in untouched `questions/`) · full `vitest` **4024 passed / 309 files, 0 regressions** · `storybook:test:ci` **455 passed / 80 suites** · `npm run i18n-parity` OK (2727 keys) · axe on `ErrorState`/`FormValidationBanner`/`InlineFieldError`/`ReadOnlyStrip` (en+vi) green. Characterization honored: baseline recorded, `DashboardErrorAlert` oracle-first, semantic assertions throughout.

## Dev Notes

### Canonical `ErrorState` — model it on `EmptyState`

`EmptyState.tsx` (10.3) is the template: a dumb presentational leaf, flat interface, never calls `t()`, never reads role, all strings arrive resolved, `data-testid` passthrough. `ErrorState` is the error analog — `role="alert"` instead of optional `role="status"`, `message` required, `detail` the optional "why", `retry`/`action` the "what-to-do". The cleanest existing exemplars to generalize: `DashboardStates.tsx` `DashboardErrorAlert` (shared surface tokens) and `ClassesPage.tsx` `ErrorAlert` (red tokens). Pick the **red error idiom** (`--cl-red`/`--cl-tint-red`, `AlertTriangle` supplied by the call site) as canonical — the `UploadDialog` `ErrorState` local fn and `ErrorStatePlaceholder` both use red; `DashboardErrorAlert`'s neutral surface is the outlier (acceptable — the token choice is call-site-neutral since the component just applies one idiom).

### The surfaces that already ship (do NOT rebuild mechanisms)

- **s63** `LatePenaltyBreakdown.tsx` — only touch the clamp + add a test. Keep it neutral/never-red (deliberate: a penalty is factual, not an alarm).
- **s64** the `attempts/` read-only spine (`attemptReadOnly.ts` + `useAttemptReadOnly.ts` + the banner in `WritingAttemptShell.tsx`, mirrored in `quiz-attempt`/`speaking-attempt`). The 1s re-lock tick means the old deferred-work FU (untimed hard-deadline mid-session re-lock, deferred-work.md:892) is effectively RESOLVED — do not reopen it. 10.4 only refines the copy on the hard-deadline branch.
- **s67** `PermissionDenied.tsx` + `RouteRoleGate.tsx` + `RouteAccessCheckingCard.tsx` — fully wired in `routes.tsx` (~25 gates incl. owner-only `/settings`, billing routes, standalone `/permission-denied`). Add ONE line (current role). The `PermissionDeniedRoles`/`SectionNameKey` unions + two/three body variants stay.
- **storage** `UploadDialog.tsx` `StorageFullBlock` + `storageCopy.ts` (role-split) + `isStorageFull`/`storagePercent`. Add ONE CTA.

### s65 feasibility constraints (read before building)

- The per-class cap `limits.studentsPerClass` (Free 5 / Pro 20 / Studio 60 in `internal/plan`) is exposed ONLY on **owner-only** `GET /api/billing` (`BillingSummary.limits`, `useBillingSummary`). A teacher cannot fetch it → the inline capacity check + Upgrade link is **owner-gated**; teacher capacity-over-cap defers to the 9.2-armed server 409 → `PlanLimitExceededDialog` (→ FU-10-4-CAPACITY-TEACHER). Upgrade is an owner action anyway.
- There is **no distinct server name-conflict code** (create → generic 422). Name-conflict is a **client** uniqueness check against the fetched class list (pass existing names into the dialog, or check in the mutation's `onError`/pre-submit). A 422 `ValidationError.details.fields[]` still maps to `setError` for any server-side field validation.
- `PlanLimitExceededDialog` is dark-launched OFF until 9.2 — do not wire new server enforcement; the client cap check is the live owner path for v1.

### s66 — the backend lock already ships; build only the FE

Exercise detail carries `locked`/`lockReason: "has_submissions"`/`lockedBy: ExerciseLock[]` (in `lib/api/client.ts`, today only in test fixtures). `ExerciseEditorPage.tsx` does not read them yet. 409 `EXERCISE_LOCKED` is unhandled. Clone exists as `useDuplicateExercise` + the library row action (`exercises.actions.duplicate`). Wire these together: read `locked` → render `ReadOnlyStrip` + read-only editor + a Clone CTA; map 409 `EXERCISE_LOCKED` → the same read-only state. **No new endpoint** (Unfinalize struck).

### Component placement, barrels, imports (FW-7, TS-7)

- `ErrorState`, `FormValidationBanner`, `InlineFieldError`, `ReadOnlyStrip` → `src/components/domain/` (tier-3, business-aware, cross-feature). Direct import `@/components/domain/X` (no `components/domain` barrel). Not in `components/ui/` (shadcn only). Consume `Button` from `@/components/ui/button`.

### Enforcement & conventions

- **R52 / Storybook three-state rule** — the new `*.stories.tsx` under `components/domain/` trip it (NOT suffix-globbed) and MUST carry `// storybook-rule: no-three-state`. Do NOT touch the `lint-bait` negative fixture.
- **i18n ratchet:** `src/lib/test/story10_4Keys.ts` + `i18n-parity-coverage.test.ts` (mirror `story10_3Keys.ts`). Locales `src/locales/en.json` + `vi.json`, both in the same change.
- **Typecheck gate = `tsc -b`** (checks test files), never `--noEmit`.
- Stack guardrails: React 19 (no `forwardRef`/`"use client"`) · strict TS (no `any`/`@ts-ignore`; flat interfaces) · Tailwind + `--cl-*` tokens, no raw hex/inline style · component never calls `t()`/reads role · no `new Date()` in render (TS-6) · TanStack Query owns retry (`refetch`), never a manual `useEffect`.

### What NOT to touch (regression guard)

Loading skeletons + empty states (10.3 owns them) · the fullscreen `ErrorBoundary`/`PermissionDenied`/`NotFound`/`RouterErrorFallback` (D1 inline-only) · toast mutation errors · the s64 lock mechanism (copy only) · the s63 neutral tone · the 409 `PLAN_LIMIT_EXCEEDED` global dialog · `PermissionDenied`'s role unions + variants (add one line) · `InboxFilterEmpty` · the `lint-bait` fixture. **No DOM snapshots** — semantic assertions only.

### References

- Epic: `epics/epic-10.md:173-221` (Story 10.4; three-part close `:213-217`; storage `:219-221`). FR-70 (three-part recovery). FR-31 (penalty). FR-23 (exercise lock; **Unfinalize struck, D5**).
- UX: `ux-design-specification.md` §6.4 (`:387-392` three-part pattern + tokens); mock `docs/classlite-entry/06c-error-states.html` (s63@5695, s64@5850, s65@5958, s66@6109, s67@6239). Component inventory `component-inventory.md:224-231, 357-361` (ErrorState / FormValidationBanner / InlineFieldError / ReadOnlyStrip / PermissionDeniedState).
- Placeholder forward-ref: `src/test/fixtures/error-state-placeholder.tsx:4-18`. 10.3 D4 deferral: `10-3-empty-states.md:28,216`; `InboxRow` 44px deferred-work.md:1263.
- s66 backend lock: `api.yaml:12536-12552` (`locked`/`lockReason`/`lockedBy`), `:12749` (Unfinalize struck). s65 caps: `internal/plan/plan.go:40,67-75`; `api.yaml BillingLimits.studentsPerClass`.
- Prior-story twin: `10-3-empty-states.md` (the consolidation playbook). Conventions: `docs/project-context.md` (UX-1/3, FW-7, TS-6/7, TEST-FE-*, TEST-UX-4), `docs/bmad-story-conventions.md` (≤600 lines; completion-notes split).

## Definition of Done

- [x] `ErrorState` (AC1) + `FormValidationBanner` + `InlineFieldError` (AC6) + `ReadOnlyStrip` (AC7) in `components/domain/`; `ErrorState` has a co-located `no-three-state` story; all four axe-zero (en+vi) via co-located tests.
- [x] All inline `ErrorAlert`s re-platformed onto `ErrorState` with no copy/role/retry/test-id regression (AC2); fullscreen screens + toasts untouched. **OnboardingDonePage excluded + flagged** (amber focus-managed orientation `<section>`, not the inline idiom — re-platform would regress focus/assertive/disabled; D1 inline-only).
- [x] 8 `ErrorStatePlaceholder` story imports swapped; fixture deleted; `storybook:test:ci` green (AC3).
- [x] s63 clamp fixed + dedicated test (AC4); s64 deadline copy + next-step, mechanism preserved (AC5); s65 banner + inline-field + name-conflict + owner capacity/Upgrade, 409 dialog preserved (AC6); s66 clone-only locked UI over backend lock, no Unfinalize (AC7); s67 current-role line (AC8); storage "View storage" CTA (AC9); `InboxRow` ≥44px (AC10).
- [x] `STORY_10_4_KEYS` exhaustive + wired; every new key in both locales; interpolation parity; prose ★ REVIEWER-MANDATORY VN (AC11).
- [x] Characterization honored: baseline-green recorded; `DashboardErrorAlert` oracle-first; semantic assertions (AC12).
- [x] Gates ALL GREEN + deterministic: `tsc -b`=0 · ESLint=0 errors · `vitest` 4024/0-regression · `storybook:test:ci` 455 green · `i18n-parity` green. `codegen.sh` NOT run (no `api.yaml`/`.sql`).
- [x] Completion-notes sibling (`10-4-error-states-completion-notes.md`) created per `bmad-story-conventions.md`.

## Out of Scope

- **Rich recovery flows (mock-only, no v1 feature):** penalty-waiver approval → **FU-10-4-WAIVER**; extension-request flow → **FU-10-4-EXTENSION**; grace-window / submission timeline visuals + s66 audit-trail card → **FU-10-4-TIMELINE**; s67 "who has access" directory → **FU-10-4-S67-DIRECTORY**.
- **Teacher-side inline capacity cap** (needs a teacher-visible cap source; owner-only billing today) → **FU-10-4-CAPACITY-TEACHER** (+ relies on 9.2 arming the server `PLAN_LIMIT_EXCEEDED` for capacity).
- **Unfinalize** — struck from FR-23 (D5); never built.
- **Fullscreen error screens** (`ErrorBoundary`, `PermissionDenied` shell, `NotFound`) re-platform — different shape; not consolidated (D1 inline-only).
- **Toast mutation errors** re-platform; **Settings → Storage** becoming actionable (it's a read-only meter; only the CTA target).
- Visual-regression tooling (Chromatic/Percy) — not MVP.

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-10-10 | DEV → review (/bmad-dev-story 10-4, Amelia). All 14 tasks + 12 ACs implemented. Canonical `ErrorState` + re-platform (ClassesPage · Assignments · Exercises · Staff · Roster · KnowledgeHub · Inbox/Archive wrappers · Rooms/TermCalendar load+save · DashboardErrorAlert oracle→8 call sites); placeholder swap+delete; s63 clamp; s64 `readOnlyBannerCopy` deadline framing (3 shells); s65 `FormValidationBanner`/`InlineFieldError`/name-conflict/owner-capacity+Upgrade/422-map; s66 clone-only `ReadOnlyStrip` + 409 flip; s67 current-role; storage View-storage CTA; InboxRow 44px; `STORY_10_4_KEYS` ratchet (12 keys). **Scope refinements (flagged):** OnboardingDonePage `ErrorAlert` EXCLUDED (amber focus-managed orientation screen, not the inline idiom — D1); capacity/storage CTAs owner-gated (owner-only billing/settings); +1 key `capacityUpgradeCta`. **Epic AC amended: "Unfinalize" struck (D2/D5) — clone-only.** Pre-existing-gate fix: `DashboardRoute.test.tsx` 10-5 `/api/classes` mock. Gates GREEN: `tsc -b`=0 · ESLint=0 · vitest 4024/0-reg · storybook 455 · i18n-parity OK. Impl record → `10-4-error-states-completion-notes.md`. VN prose ★ REVIEWER-MANDATORY. Next: /bmad-code-review 10-4 (diff LLM). | Amelia (/bmad-dev-story 10-4) |
| 2026-10-09 | Story created (backlog → ready-for-dev). 4-agent recon (error substrate/s67 · student s63/s64 · teacher s65/s66/storage · UX spec). Canonical `ErrorState` (placeholder names 10.4 as its replacement) + full re-platform; s63–s67 + storage + `InboxRow` 44px gap-fill. 4 Ducdo rulings: D1 FULL consolidation (10.3 parity, inline-only) · D2 clone-only s66 locked UI + **epic AC amended to drop struck Unfinalize** · D3 s65 canonical components + client name-conflict + owner-gated capacity/Upgrade · D4 epic-AC level, stub-or-omit recovery, defer rich flows. WF-8 NOT triggered (pure FE, no API/DB); dominant risk = silent regression on re-platform → characterization-first; VN prose ★ REVIEWER-MANDATORY. baseline 9087e33. | Amelia (/bmad-create-story 10-4) |

## Review Findings

_From `/bmad-code-review 10-4` (2026-10-10, 3-layer adversarial: Blind Hunter + Edge Case Hunter + Acceptance Auditor). 2 decision-needed, 2 patch, 0 defer, 11 dismissed. No Critical/High. Every hard constraint (AC1 no-`t()`/role, AC2 fullscreen carve-out, AC4 clamp, AC5 mechanism-preserved, AC6 409 dialog, AC7 no-Unfinalize, AC11 both-locale ratchet) CONFIRMED met._

- [x] [Review][Decision→Patch] s66 Clone is the sole unlock path but has no failure feedback — `ExerciseLockedView.onClone` (`ExerciseEditorPage.tsx:113-118`) calls `duplicate.mutate(..., { onSuccess })` with **no `onError`**; `useDuplicateExercise` (`api/useDuplicateExercise.ts:11-20`) has no global error toast. A failed clone silently dead-ends the only unlock path. **RESOLVED (Ducdo 2026-10-10): FIX NOW** — add an `onError` sonner toast (app mutation-error idiom) + net-new `exercises.locked.clone.error` key (both locales) + ratchet entry. → see Patch below. (Medium)
- [x] [Review][Decision] Owner over-cap capacity guard blocks ALL edits to a grandfathered class — `if (capacityOverPlan) return` fires for create AND edit (`ClassFormDialog.tsx:220`). **RESOLVED (Ducdo 2026-10-10): ACCEPT as v1 behavior** — an owner whose plan cap was later lowered below an existing class's capacity reduces capacity to save edits; narrow (requires a post-hoc downgrade), documented, no code change. (Low-Med)
- [x] [Review][Patch] InlineFieldError "red-bordered input state" (AC6) — FIXED: `Field` now `cloneElement`s its control to set `aria-invalid` whenever it has an error (centralized, covers all current + future fields), preserving the capacity field's explicit over-plan `aria-invalid`. [classlite-web/src/features/classes/components/ClassFormDialog.tsx:440-460]
- [x] [Review][Patch] Clone-failure recovery affordance (resolved Decision #1) — FIXED: `ExerciseLockedView.onClone` now has `onError: () => toast.error(t('exercises.locked.clone.error'))` (sonner, app idiom); net-new key added both locales + `STORY_10_4_KEYS`. [classlite-web/src/features/exercises/ExerciseEditorPage.tsx:113]

_Patches applied + verified 2026-10-10: `tsc -b`=0 · ESLint=0 · `i18n-parity` OK (2728 keys, +1) · 1113 tests green across ClassFormDialog / ExerciseEditorPage / InlineFieldError / i18n-parity-coverage._

### Dismissed (verified non-issues)

- ErrorState drops `data-testid` / `role="alert"` (Blind) — **false**: `ErrorState.tsx:67-68` forwards both; retry props guarded by `showRetry` (`:62`).
- `readOnlyBannerCopy` mistreats `undefined` hard-deadline (Blind) — not reachable; `hardDeadlineAt` is typed `string | null` on the attempt bundle.
- 422 maps an unregistered whitelist field → silent (Blind) — all `FIELD_ERROR_TARGETS` (`:57-65`) are registered RHF fields, and `FormValidationBanner` enumerates `Object.values(errors)` so any `setError` still surfaces.
- Client name-conflict misses out-of-scope classes (Blind+Edge) — by design (D3: client-only check, no distinct server code; best-effort).
- Clamp understates true penalty / band=0 shows "0.0" (Blind+Edge) — AC4-mandated re-sum; flagged tradeoff; band=0 + positive penalty is cosmetic and off-domain.
- `DashboardErrorAlert` prop rename breaking (Blind) — compiler-caught; all callers migrated in-diff.
- `appliedPenalty` NaN renders "NaN" (Edge) — contract types it `number`; not realistic.
- Mixed known+unknown 422 drops the unknown message (Edge) — server returns a generic flat 422 for class-create (Auditor-confirmed); not triggered by the real contract.
- 422 reads `err.details[]` not `details.fields[]` (Auditor) — matches the actual `ApiError.details` shape; functionally correct + tested.
- `InlineFieldError` axe runs one locale (Auditor) — renders a single resolved `<p>`; a11y structure is locale-invariant.
- ★ VN prose (8 net-new keys) — Auditor inspected all 8; both-locale + token parity confirmed; VN reads fluent. Residual human eyeball only.

## Dev Agent Record

_Implementation record (Debug Log, Completion Notes, File List) → sibling [`10-4-error-states-completion-notes.md`](./10-4-error-states-completion-notes.md) per `docs/bmad-story-conventions.md`._

### Agent Model Used

_TBD at dev pickup._

### Debug Log References

_See sibling completion-notes → Dev Agent Record._

### Completion Notes List

_See sibling completion-notes._

### File List

_See sibling completion-notes → File List._
