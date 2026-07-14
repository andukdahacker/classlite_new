---
baseline_commit: c639031
---

# Story 2.4: Post-Onboarding Checklist & First AI Grade Card

Status: done

<!-- Baseline: c639031 (Story 2-3c shipped review → done after Round 1 `/bmad-code-review 2-3c` — /setup/done celebration + DoneHeroPanel + Save-and-finish-later on 3 pages + 6-branch guard ladder + 13 new `onboarding.done.*` keys + 11 Storybook variants + 1058/1058 vitest). -->
<!-- This story lands the "Finish setting up" checklist card + persona-branched dashboard first-run value on `/dashboard`. It REPLACES the shipped 2-3a/b welcome-back banner slot with the completion-time checklist experience — the two never render simultaneously (banner shows when `currentStep !== 'done'`; card shows when `currentStep === 'done' && persona != null`). -->
<!-- No `api.yaml` touch. Snooze persistence is client-side (`localStorage` per-user-id key). Story 6.2 dependency discharged via a hardcoded sample-essay fixture — the real "Run AI grading" pipeline lands with Epic 6. -->
<!-- Party-mode adversarial review folded 2026-07-13 → 2026-07-14 (Sally + Winston + Amelia + Murat as fresh-context general-purpose subagents, parallel; John ruled). 81 findings: 17 BLOCKERs + 43 STRONGs + 21 INFOs. 78 ACCEPTed inline; 2 DEFERRED (W-STRONG-9 → FU-2-4-H, S-INFO-19 + W-INFO-18 → info-record); 0 REJECTED. Highest-leverage folds: use shipped Sonner (S-BLOCKER-2/W-STRONG-8/A-BLOCKER-2 3-way); STORY_2_3A_KEYS + STORY_2_3B_KEYS + ALLOWED_PREFIXES atomic commit (W-BLOCKER-1/A-BLOCKER-3/M-STRONG-16); user.displayName not user.fullName (A-BLOCKER-1/W-STRONG-12); mockup-fidelity 7 items not 6 (S-BLOCKER-1); shared `src/lib/teachersInvitedCount.ts` + port 2-3c (W-BLOCKER-3 pragmatic); DROP Dismiss from v1 (S-STRONG-13); per-persona body-component split (S-STRONG-11); stableProps latch (W-BLOCKER-2); pinned STORY_2_4_KEYS closed literal (M-BLOCKER-1); 12-cell mutex expected-render table (W-STRONG-14/M-STRONG-15). -->

## Story

As a **user who just completed onboarding and landed on the dashboard**,
I want to **see a fraction-tracked "Finish setting up" card of remaining tasks, plus a persona-appropriate first-run value card (a sample AI-graded essay for teachers/founders, a sample analytics preview for owner-only operators) plus my actual classes shown below**,
so that **I know what still needs configuring AND I feel ClassLite's core value on my first paint — not "onboarding done, now what?"**

## Response Envelope Contract (inherited from Stories 2.1 + 2.3a/b/c)

This story does not touch any endpoint. `useOnboardingProgress()` (GET `/api/onboarding/progress`) and `useCurrentCenter()` (session-cache selector) are the ONLY data sources — both already consumed by shipped `TeacherDashboard.tsx`. Success shape for GET progress: `{ data: { currentStep, payload, updatedAt, persona }, meta }`. `apiFetch` unwraps `meta`; consumers read `data` only. Snooze state persists to `localStorage` under a per-user-id key — no wire call. **No new MSW handlers required for the checklist card itself** (Task 6 tests inherit the shipped 2-3a MSW `/api/onboarding/progress` handlers via the `progressWithPersona(persona, currentStep, payload)` factory at `handlers.ts:267`).

## Acceptance Criteria

1. **`<FinishSetupCard>` renders on `/dashboard` inside `TeacherDashboard.tsx` when ALL of the following hold** (visibility gate): (a) `progress.data.currentStep === 'done'` (onboarding complete); (b) `progress.data.persona != null` (persona picked — null persona means the shipped welcome-back banner takes over, not this card); (c) `useCurrentCenter() !== null` (center exists); (d) the checklist is not snoozed (`snoozedUntil == null || Date.now() >= snoozedUntil`) per the state model in AC5. The card mounts ABOVE the persona-branched first-run value card (AC7/AC8) in the DOM per mockup `s09` (`docs/classlite-entry/01-owner-onboarding.html:7541-7683`). When the gate fails, no card renders — no whitespace, no placeholder.

   **Loading/error state matrix** [S-BLOCKER-4 + M-STRONG-7 + W-STRONG-7 fold]. Task 6.6 enumerates the 8-cell decision table for what the dashboard shell renders. `WelcomeBackBanner` refers to the shipped 2-3a/b banner logic (existing `showBanner` guard in `TeacherDashboard.tsx:55`). `FinishSetupCard` refers to this story's card. `stableProps` denotes the render-latch introduced by AC1a below.

   | # | `progress.isLoading` | `progress.isError` | `currentCenter` | Expected render |
   |---|---|---|---|---|
   | 1 | `true` | `false` | any | `<DashboardSkeleton>` (heading skeleton + 3 card-shaped skeletons — mirrors AC1 layout at rest heights) |
   | 2 | `false` | `false` | `null` | `<WelcomeBackBanner>` (`midWizardNoCenter` branch inherited) + heading; no card |
   | 3 | `false` | `false` | valid + `currentStep !== 'done'` | `<WelcomeBackBanner>` (`postCenterIncomplete` branch inherited) + heading; no card |
   | 4 | `false` | `false` | valid + `currentStep === 'done'` + `persona == null` | `<WelcomeBackBanner>` (`awaitingNextStep` copy — shipped fallback) + heading; no card |
   | 5 | `false` | `false` | valid + `currentStep === 'done'` + `persona != null` + snoozed | heading + persona-value card only; no FinishSetupCard |
   | 6 | `false` | `false` | valid + `currentStep === 'done'` + `persona != null` + not snoozed | heading + `<FinishSetupCard>` + persona-value card |
   | 7 | `false` | `true` | `null` | `<WelcomeBackBanner>` (`progressUnknownNoCenter` branch inherited) + heading; no card |
   | 8 | `false` | `true` | valid | Retain last-successful `stableProps` snapshot if held; else render heading only + inline `<Alert>` with retry button + `requestId` cite. Do NOT auto-route. |

   **`stableProps` render-latch** [AC1a per W-BLOCKER-2 fold]. `TeacherDashboard.tsx` captures the FIRST valid `{ progress.data, currentCenter, user }` snapshot into a `useState` render-latch. Subsequent `useOnboardingProgress` refetches that transiently flip `progress.data` to `undefined` (window-focus refetch race — the shipped hook does NOT pass `refetchOnWindowFocus: false`) do NOT unmount the card — the latch holds. Direct 2-3c precedent (`OnboardingDonePage.tsx` `stableProps`, completion notes lines 10-11). Reset the latch when the AC1 gate fails on a NEW (non-transient) `progress.data` snapshot — cheap heuristic: `progress.data === undefined && progress.isFetching === false`. Test coverage under Task 6.6 cell 8.

2. **Card structure (mirrors mockup `s09` `.finish-setup` block, lines 7600-7683):** (a) header row — Fraunces italic eyebrow `t('dashboard.checklist.eyebrow')` = "Finish setting up" + Fraunces italic title `t('dashboard.checklist.title.<persona>')` per persona + one-line subtitle `t('dashboard.checklist.subtitle.<persona>')` on the left; fraction display `{completed}/{total} complete` (denominator styled smaller per mockup :7608 — `text-xl text-slate-500`) + horizontal progress bar on the right; (b) task list — one `<li>` per item in the persona's checklist enumeration (AC3), with icon glyph + name + optional short subtitle + status badge (`Done` / `Required` / `Optional` / `Coming soon`) + trailing arrow (`✓` for done, `→` for pending); (c) footer row — left slot `t('dashboard.checklist.footer.autosave')` = "Auto-saves · come back any time from Settings → Setup" (Story 2.5 wires Settings; copy pre-announces the entry point) + right slot: `t('dashboard.checklist.snoozeCta')` text button ("Snooze for a week"). **Dismiss button DROPPED from v1** per S-STRONG-13 — user has NO in-app recovery until Story 2.5 ships Settings → Setup (FU-2-4-D); shipping Dismiss without a reopen path is a trap. Snooze covers the "not now" case; user can re-snooze indefinitely.

   **Fraction aria-live announcement** [S-STRONG-6 fold]. The `{completed}/{total} complete` block is wrapped in `<div aria-live="polite" aria-atomic="true">` so SR announces state changes on refetch (e.g., "3 of 7 complete" → "4 of 7 complete" when a downstream story ships a target surface and the resolver flips). Task 3.3 test row asserts the aria-live wrapper is present.

   **Data-testid inventory for this card** (M-STRONG-14 fold — full inventory in Dev Notes §"data-testid inventory"): `dashboard-checklist-card`, `dashboard-checklist-fraction`, `dashboard-checklist-progress-bar`, `dashboard-checklist-item-<id>` per item, `dashboard-checklist-snooze-cta`.

3. **Per-persona checklist enumeration** — closed literal `Record<Persona, ChecklistItem[]>` in `src/features/dashboard/lib/checklistDefinition.ts`. Each item: `{ id, i18nKey, subtitleKey?, badge: 'required' | 'optional' | 'comingSoon', isDone: (ctx) => boolean, targetPath: string, targetSurface: 'settings' | 'billing' | 'students' | 'classes' | 'templates' | 'resources' | 'people' | 'grading', epicNum: number }`. `isDone(ctx)` reads from a normalized `ChecklistCtx` shape `{ currentCenter: CenterSummary, templateDraft: TemplateDraftPayload | null, teachersInvitedCount: number }`. **Resolvers read `ctx.currentCenter`, NOT `ctx.session.center` — the AC1 selector and per-item completion must agree on the same snapshot** [W-BLOCKER-4 fold]. **`ctx.templateDraft` is normalized to `progress.data?.payload?.templateDraft ?? null`; every resolver `?.`-chains from `ctx.templateDraft`** [A-STRONG-13 fold] — Solo Teacher's null `templateDraft` must not throw.

   **`teachersInvitedCount` derivation** [W-BLOCKER-3 pragmatic fold]. Extracted to **`src/lib/teachersInvitedCount.ts`** (shared-lib location, mirrors `src/lib/onboardingPayload.ts` per project TS-7 convention — NOT `src/features/dashboard/lib/`). Story 2-3c's `OnboardingDonePage.tsx` is refactored to import from this same location in the SAME commit (pragmatic in-scope port per `[[feedback_pragmatic_interpretation_of_spec_absolutes]]` — dual-implementation drift is worse than a one-commit 2-3c edit). Implementation carries the full 2-3c Round 1 hardening: case-insensitive normalization + trim + Set-based dedup + whitespace-only filter + `?? ''` null-user fallback. Full JSDoc citing 2-3c AC1 as source of truth.

   **Enumeration per persona** (mockup `s09` fidelity — 7 items for Operator/Founder per fs-tasks lines 7614-7677 [S-BLOCKER-1 fold]):

   - **Operator (Admin — non-teaching Owner)** — 7 items, fraction denominator = 7:
     1. `centerCreated` — Required. `isDone`: `ctx.currentCenter != null`. Auto-done on load. Target `/settings`, `targetSurface: 'settings'`, `epicNum: 5` (Story 2.5).
     2. `templatePicked` — Required. `isDone`: `ctx.templateDraft?.selectedTemplateId != null || ctx.templateDraft?.buildFromScratch === true`. Auto-done post-2-3b. Target `/templates`, `'templates'`, epic 5 (Story 3.3).
     3. `firstClassesSpawned` — Required. `isDone`: `(ctx.templateDraft?.spawnedClassIds?.length ?? 0) > 0`. Auto-done post-2-3b. Target `/classes`, `'classes'`, epic 5 (Story 3.1).
     4. `teachersInvited` — Required. `isDone`: `ctx.teachersInvitedCount > 0`. Pending if user reached `/setup/done` without assigning any teacher. Target `/people/staff`, `'people'`, epic 5 (Story 2.6).
     5. `enrolStudents` — **Optional (badge "Coming soon")** [S-INFO-20 + A-STRONG-14 fold]. Resolver always `false` in v1 (no student-enrolment data source on FE). Explicitly documented as "displays pending forever in v1 by design — Story 2.7 makes it completable". Target `/students`, `'students'`, epic 5 (Story 2.7).
     6. `createMoreClasses` — Optional [S-BLOCKER-1 fold — restored from mockup line 7654]. `isDone`: always `false` in v1 (no dashboard signal for "user spawned a class after landing"). Target `/classes`, `'classes'`, epic 5 (Story 3.1).
     7. `addResources` — Optional [S-BLOCKER-1 fold — restored from mockup line 7669]. `isDone`: always `false` in v1. Target `/knowledge-hub`, `'resources'`, epic 5 (Story 4.4).

     **`setupBilling` REMOVED from v1** [S-INFO-20 + AC6 free-tier alignment fold]. Free-tier positioning (Epic AC6 + PRD FR-72) means "no urgency to pay in v1 is a feature, not a bug". `setupBilling` becomes a `FU-2-4-E` merge candidate for Epic 9 pickup.

   - **Founder (Owner who teaches)** — 7 items, fraction denominator = 7. Identical enumeration to Operator. `teachersInvited` expected pending for pure-Founder centers.

   - **Solo Teacher (single-user workspace)** — 4 items, fraction denominator = 4 [A-STRONG-7 + S-STRONG-10 fold — resolved at story time via shipped `SoloFirstClassPage.tsx` grep confirming Solo passes through `/setup/center`, so `session.center` is always truthy]:
     1. `centerCreated` — Required. Auto-done (Solo always has a center per shipped `useCreateCenter` path).
     2. `firstClassSpawned` — Required. `isDone`: same resolver as Operator's `firstClassesSpawned` (Solo lands on `/setup/first-class` — same `spawnedClassIds` field).
     3. `enrolStudents` — Optional ("Coming soon" badge). Same as Operator.
     4. `addResources` — Optional. Same as Operator.

     **Solo drops** `templatePicked` (implicit in the single-class flow), `teachersInvited` (Solo is the lone teacher — no invite loop), `createMoreClasses` (Solo v1 is single-class scope).

   **Fraction display** — count `items.filter(item => item.isDone(ctx)).length` over `items.length`. Progress bar width = `100 * completed / total` (integer percentage, no decimals). Optional items count in the denominator.

4. **Snooze click** — clicking `t('dashboard.checklist.snoozeCta')` calls `useChecklistState().snooze()` which writes `{ snoozedUntil: Date.now() + 7 * 24 * 3600 * 1000 }` to localStorage under `` `classlite_finish_setup_v1_${user.id}` ``. Card unmounts immediately (via `useSyncExternalStore` bump). Card re-appears when `Date.now() >= snoozedUntil`. **Timezone** — `Date.now()` is UTC epoch ms; no locale drift. **Sentry breadcrumb** [M-STRONG-8 fold] `checklist-snoozed` fires on click with payload `{ userId, persona, completed, total, snoozedUntil }` — feature-adoption signal for post-launch Product review.

   **Test contract [M-B4]** — `test.each` over 3 rows: (a) click snooze → card unmounts within one render tick (asserted after `rerender()`); (b) `vi.setSystemTime(snoozedUntil - 1000) + rerender` → card stays hidden; (c) `vi.setSystemTime(snoozedUntil + 1000) + rerender` → card renders again. **`useSyncExternalStore` fake-timer note** [M-STRONG-17 fold]: `getSnapshot` recomputes `isVisible` from `Date.now()` on any re-render — test MUST call `rerender()` after `vi.setSystemTime` to observe the transition. Advancing time alone does NOT trigger `getSnapshot`; the hook does not poll.

5. **Snoozed-boundary auto-re-read via scheduled bump** [W-STRONG-15 fold]. On mount, if `snoozedUntil != null && snoozedUntil > Date.now()`, `useChecklistState` schedules `setTimeout(bump, snoozedUntil - Date.now() + 1000)`. Cleared on unmount. Prevents the tab-B stale case where tab-A snoozed 7d ago but tab-B is idle — the scheduled bump forces the boundary re-read without a poll. Test row Task 1.2 (d) asserts scheduled bump fires at boundary; Task 1.2 (d.ii) asserts cleanup on unmount.

6. **`useChecklistState` hook** at `src/features/dashboard/hooks/useChecklistState.ts` — signature `(userId: string | null) => { state: ChecklistState, snooze(): void, isVisible: boolean }`. `ChecklistState = { snoozedUntil: number | null }`. Persistence:
   - `subscribe` is a **module-scope constant** [A-STRONG-12 fold] (NOT inline inside the hook body — React 19 requires stable `subscribe` reference across renders; inline arrow re-subscribes each render). Signature: `(notify: () => void) => (window.addEventListener('storage', notify), () => window.removeEventListener('storage', notify))` + bump-counter subscriber via a private `Set<() => void>`.
   - `getSnapshot` per-userId — reads `localStorage.getItem(key)` and JSON-parses (try/catch — malformed → `{ snoozedUntil: null }` fresh + `Sentry.addBreadcrumb({ category: 'checklist', message: 'malformed-localstorage', level: 'warning', data: { userId, keySnippet: raw.slice(0, 20) } })`; never throw). Missing key → same fresh default.
   - `snooze()` writes + bumps. Fires Sentry breadcrumb per AC4.
   - `userId === null` (transient boot-probe / anonymous) → returns `{ state: fresh, isVisible: false, snooze: noop }`. Guards against writing to a null-scoped key.
   - **`userId` transition** [W-STRONG-5 + M-STRONG-12 fold] — the hook body derives `const key = userId ? \`classlite_finish_setup_v1_${userId}\` : null`. When `userId` changes (logout → login as different user on same browser), `useSyncExternalStore` re-reads via the same subscribe; `getSnapshot` closes over the CURRENT `userId` (via the passing-per-render closure), returning fresh data for user B. Test row Task 1.2 (i) asserts rerender-with-new-userId returns fresh state; user A's `snoozedUntil` does NOT leak into user B's `isVisible`.
   - **StrictMode + test-isolation** [W-STRONG-6 fold] — module-scope `Set<() => void>` subscribers stay bounded because subscribe returns cleanup. Every test file MUST run `beforeEach(() => { window.localStorage.clear(); /* reset any module-scope bump state if a test suite-scoped reset is exposed */ })`. Task 1.2 setup boilerplate spec.
   - `isVisible` = `snoozedUntil == null || Date.now() >= snoozedUntil`. Component composes with the AC1 gate.

   **`MALFORMED_LOCALSTORAGE_FIXTURES` closed literal** [M-STRONG-11 fold] — Task 1.2 (e) enumerates 6 rows: `''` (empty), `'null'` (JSON null literal), `'{}'` (empty object), `'{"snoozedUntil":"abc"}'` (wrong type), `'{unclosed'` (parse error), `'[]'` (wrong root type). Each row asserts (i) treated as `{ snoozedUntil: null }` fresh; (ii) does not throw; (iii) Sentry breadcrumb fires with keySnippet payload; (iv) subsequent `snooze()` call succeeds and overwrites.

7. **AI grade card for Founder / Solo Teacher (Epic AC4).** When `progress.data.persona ∈ {'founder', 'solo_teacher'}` AND cell 5 or 6 (AC1 matrix) applies, mount `<FirstAIGradeCard>` in the dashboard column BELOW the checklist card. Card renders a hardcoded sample essay preview (fixture at `src/features/dashboard/lib/sampleAIGrade.ts`):
   - Header — Fraunces italic title `t('dashboard.aiSample.title')` = "Grading looks like this." [S-STRONG-12 voice-alignment fold — was "See ClassLite AI in action" which read as marketing brochure vs UX-DR21 quiet-competence] + inline `<span class="ai-mark">` with the AI gradient chip styling [A-BLOCKER-4 + S-INFO-17 fold — `AiMark` component grep-confirmed absent; inline resolution now, `// TODO(FU-2-4-C): promote to <AiMark>` marker on the span].
   - Sample essay preview — 3-line clamp `<blockquote>` with the fixture IELTS Writing Task 2 excerpt (`t('dashboard.aiSample.essayExcerpt')` — English + Vietnamese pre-drafted; Vietnamese is an idiomatic IELTS practice essay, NOT a raw translation — **Ducdo reviews VN copy at story time, not code review** [S-STRONG-8 discipline fold]).
   - Overall band score `band-ring` circular indicator ("6.5" fixture) + 4 per-criterion horizontal bars (Task Response 6.5 / Coherence 6.0 / Lexical 7.0 / Grammar 6.5).
   - Teacher-facing feedback quote (`t('dashboard.aiSample.feedbackQuote')` = "Strong topic sentence in paragraph 2 — anchors the argument. Try tightening the conclusion (2-3 sentences max).").
   - Footer — user-oriented disclaimer `t('dashboard.aiSample.disclaimer')` = "Sample essay — this is how a real grade will look once your students hand in work." [S-STRONG-8 voice rewrite]. **NO "See how grading works →" CTA** [S-STRONG-7 fold — dishonest dead-link removed; card delivers value inline; silence is more credible than an unfulfilled promise; when Epic 6 ships, FU-2-4-F picks up the live CTA].

   **NO cost / credit budget shown** (misleading before Epic 6). Card is a PREVIOUS ONLY. **Motion note** [S-INFO-16 fold]: v1 renders static SVG; when FU-2-4-F wires the live pipeline, animation MUST respect `prefers-reduced-motion: reduce`.

8. **Sample dashboard preview for Operator (Epic AC5).** When `progress.data.persona === 'operator'` AND cell 5 or 6 applies, mount `<SampleDashboardPreview>` in the dashboard column BELOW the checklist card (mutually exclusive with `<FirstAIGradeCard>` per AC7). Card renders hardcoded placeholder analytics (fixture at `src/features/dashboard/lib/sampleOwnerPreview.ts`):
   - 4-up pulse-stat strip — Sessions today / Grading queue / At-risk students / Center attendance — **ghosted-frame treatment per UX §6.4** [S-STRONG-9 fold] — real tile frames at 0.5 opacity + em-dash values + labeled amber threshold banner `t('dashboard.samplePreview.thresholdBanner')` = "Your center analytics fill in once teachers start grading."
   - Footer — `t('dashboard.samplePreview.disclaimer')` = "This is a preview. Real numbers land as your team teaches, grades, and enrols."

   Rationale — Operator is a non-teaching Admin; a graded essay would feel wrong (they don't grade). Center-pulse analytics is the value they'll compound.

9. **"Your classes" row** [S-BLOCKER-3 fold — mockup line 7685-7728]. Mount `<YourClassesRow>` BELOW the persona-value card (AC7/AC8) for ALL personas when cell 5 or 6 applies. Renders up to 2 class cards from `progress.payload.templateDraft.classesDraft.slice(0,2)` — each card shows `cohortName` + `startDate` (locale-formatted) + a placeholder stat strip (`—` values for students / sessions / next-session — real numbers land Epic 3+ / Epic 5+). If `classesDraft` is empty/undefined (defensive; shouldn't happen per AC1 gate), render a locale-appropriate ghost card `t('dashboard.yourClasses.ghost')` = "Your first classes at {{centerName}} will show up here." + dashed "+ Create another from template" CTA using `<DeadLinkTrigger>` (AC10). **XSS safety** [W-INFO-17 fold] — `cohortName` is a user-typed string; render via React text-node interpolation (auto-escaped); aria-labels are composed via i18n interpolation (`t('dashboard.yourClasses.cardAriaLabel', { name })`), NOT string concatenation. Task 5.4 test row: `cohortName` set to `<script>alert(1)</script>` renders as text-node (assert `container.querySelector('script')` is null).

10. **Free-tier positioning (Epic AC6) — NO 7-day Pro trial mechanic.** No positive UI work; this AC is a "do not introduce" guarantee. Enforcement via a strict grep-audit:
    - **Scan scope** [M-STRONG-13 fold]: `src/{features/dashboard,locales}/**/*.{ts,tsx,json}` (dashboard code AND both en/vi JSON files — translator-inserted "dùng thử 7 ngày" copy in `vi.json` is a real leak vector).
    - **Reject-list closed literal** [M-STRONG-9 fold]: instead of a naive `/\btrial\b/i` regex, the test asserts each of these substrings is ABSENT: `trial`, `Pro trial`, `startPro`, `upgradeToPro`, `sevenDayTrial`, `freeTrial`, `dùng thử`, `bản dùng thử` (case-insensitive). Reject-list is a closed literal at the top of `src/features/dashboard/__tests__/noTrialMechanic.test.ts`.
    - **Whitelist** [A-STRONG-5 fold]: a match is IGNORED only if the same line contains the marker `NO_TRIAL_MECHANIC_V1` (self-documenting comment). Test file itself is excluded from the scan (`.test.ts` excluded from glob).
    - Sentry breadcrumb `checklist-trial-mechanic-audit-passed` in the test run marks CI-side ratchet.
    - `<FinishSetupCard>` and `<FirstAIGradeCard>` MUST NOT route to `/upgrade` or `/trial` — enforced by AC11 `<DeadLinkTrigger>` target-path allow-list.

11. **Dead-link handling via shipped Sonner toast** [S-BLOCKER-2 + W-STRONG-8 + A-BLOCKER-2 3-way convergence fold]. **The project already mounts `<Toaster richColors closeButton />` from `@/components/ui/sonner` at `App.tsx:74`.** Do NOT ship an inline `<div role="alert">` toast (custom-toast reinvention). Do NOT ship FU-2-4-B (shared toast bus — already discharged by Sonner).

    New `<DeadLinkTrigger>` primitive at `src/features/dashboard/components/DeadLinkTrigger.tsx`. Props `{ targetPath: string, targetSurface: string, epicNum: number, children: ReactNode, className?: string }`. On click: (a) does NOT `navigate()`; (b) calls `toast.info(t('dashboard.deadLink.notReady', { epicNum }), { id: 'dashboard-dead-link', duration: 4000 })` — the fixed `id` acts as a queue-of-one (Sonner replaces the toast on subsequent clicks — no stacking, no double-`role="alert"` axe violation from W-STRONG-8); (c) fires Sentry breadcrumb `dashboard-dead-link-tapped` with `{ targetPath, targetSurface, epicNum }` (rage-click note W-INFO-16: N clicks = N breadcrumbs = feature-demand signal; single toast).

    **testid discipline** — the story spec does NOT specify a testid on the toast slot (Sonner portals the toast to `document.body`; testid stability on the portalled DOM is fragile). Tests assert via `screen.findByRole('status')` (Sonner default) or `screen.findByText(i18n.t('dashboard.deadLink.notReady', { epicNum }))`. Task 7.2 pattern.

    All 8 dead-link paths (`/settings`, `/templates`, `/classes`, `/people/staff`, `/students`, `/knowledge-hub`, `/grading`, `/settings/billing` — the last only if a future Epic 9 story links to it; NOT a v1 checklist target per AC3 restructure) go through `<DeadLinkTrigger>`. When ANY target surface later ships, the checklist item's `<DeadLinkTrigger>` swaps for `<button onClick={() => navigate(item.targetPath)}>` — 1-line change per item.

12. **Layout ordering on `/dashboard`** [S-BLOCKER-3 fold + S-STRONG-11 UX-3 fold] — the shipped `TeacherDashboard.tsx` currently renders `{welcome-back banner} + {h1 heading}`. Story 2-4 amends via **per-persona body components** [S-STRONG-11 kills UX-3 violation now, not deferred to 2.6]:

    ```
    <TeacherDashboard>
      {WelcomeBackBanner — mounts only on cells 2/3/4/7 per AC1 matrix}
      {WelcomeHeading — mounts on all non-loading cells}
      {switch (persona) {
        case 'operator': <OperatorDashboardBody />
        case 'founder': <FounderDashboardBody />
        case 'solo_teacher': <SoloTeacherDashboardBody />
        default: null  // fallback covered by banner branch
      }}
    </TeacherDashboard>
    ```

    Where each `<*DashboardBody>` composes: `<FinishSetupCard />` (via AC1 gate) + `<FirstAIGradeCard />` or `<SampleDashboardPreview />` (persona-specific) + `<YourClassesRow />` (AC9). **`<OperatorDashboardBody>` / `<FounderDashboardBody>` / `<SoloTeacherDashboardBody>` land under `src/features/dashboard/`** (feature-local, ~30-40 LoC each — tiny). Story 2.6 (route-level split) then picks up per-persona routing WITHOUT a rewrite of the bodies — just a routing swap.

    **Welcome heading**: `t('dashboard.welcomeHeading', { name: user?.displayName ?? user?.email ?? '' })` [A-BLOCKER-1 + W-STRONG-12 fold]. When `useAuth().isLoading === true` (boot-probe tick), render a Skeleton block per the AC1 matrix cell 1 (heading skeleton). The `?? user?.email ?? ''` chain matches shipped `SoloFirstClassPage.tsx:443` + `ClassSpawnPage.tsx:252`.

    **h1 focus-mount** [A-STRONG-6 + M-INFO-19 fold] — no `tabIndex={-1}` on the h1 (would be dead code per CQ-1 with no focus-on-mount contract). Focus stays on the router-managed link that navigated the user in. Return-visit landing, not a celebration.

13. **i18n key namespace split — REPARENT shipped `dashboard.finishSetup.*` keys to `dashboard.welcomeBack.*`** with a 4-file atomic commit [W-BLOCKER-1 + A-BLOCKER-3 + M-STRONG-16 3-way fold]:

    | Shipped key | New key | Copy change? |
    |---|---|---|
    | `dashboard.finishSetup.banner` | `dashboard.welcomeBack.banner` | No |
    | `dashboard.finishSetup.continueCta` | `dashboard.welcomeBack.continueCta` | No |
    | `dashboard.finishSetup.awaitingNextStep` | `dashboard.welcomeBack.awaitingNextStep` | No |

    **Atomic-commit file list** (all 4 files MUST land in ONE commit to prevent transient CI red):
    - `src/locales/en.json` + `src/locales/vi.json` — rename keys
    - `src/features/dashboard/TeacherDashboard.tsx` — 3 `t()` sites (`TeacherDashboard.tsx:73,74,85,100`)
    - `src/lib/test/__tests__/i18n-parity-coverage.test.ts` — ALL of:
      - `STORY_2_3A_KEYS` array at lines 864-866: rename 3 entries to `dashboard.welcomeBack.*`
      - `ALLOWED_PREFIXES` in the 2-3a describe block at line 878: replace `'dashboard.finishSetup.'` with `'dashboard.welcomeBack.'`
      - JSDoc at line 801 that names the prefix: rename to `dashboard.welcomeBack.`
      - `STORY_2_3B_KEYS` ALLOWED_PREFIXES_2_3B at line 994: replace `'dashboard.finishSetup.'` with `'dashboard.welcomeBack.'`

14. **i18n parity — pinned `STORY_2_4_KEYS` closed literal + prefix-ratchet block** [M-BLOCKER-1 fold — pin the EXACT list at story time, not green-phase]. Append `describe('Story 2-4 i18n parity (R38)', () => { ... })` to `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with the closed literal below (**exactly 42 keys** — dev matches this list verbatim in en/vi). Prefix ratchet: `describe.each(STORY_2_4_KEYS)` asserts every key starts with one of `['dashboard.welcomeHeading', 'dashboard.checklist.', 'dashboard.aiSample.', 'dashboard.samplePreview.', 'dashboard.yourClasses.', 'dashboard.deadLink.']`. `assertI18nInterpolationParity(STORY_2_4_KEYS, ['en', 'vi'])` covers ALL 42 keys — the helper surfaces token diffs per key regardless of expected token set [M-BLOCKER-5 fold].

    ```typescript
    export const STORY_2_4_KEYS = [
      // welcome heading (1)
      'dashboard.welcomeHeading',                             // {{name}}
      // checklist header + copy (10)
      'dashboard.checklist.eyebrow',
      'dashboard.checklist.title.operator',
      'dashboard.checklist.title.founder',
      'dashboard.checklist.title.solo_teacher',
      'dashboard.checklist.subtitle.operator',
      'dashboard.checklist.subtitle.founder',
      'dashboard.checklist.subtitle.solo_teacher',
      'dashboard.checklist.fractionAriaLabel',                // {{completed}} + {{total}}
      'dashboard.checklist.snoozeCta',
      'dashboard.checklist.footer.autosave',
      // checklist item names (7)
      'dashboard.checklist.item.centerCreated.name',
      'dashboard.checklist.item.templatePicked.name',
      'dashboard.checklist.item.firstClassesSpawned.name',
      'dashboard.checklist.item.teachersInvited.name',
      'dashboard.checklist.item.enrolStudents.name',
      'dashboard.checklist.item.createMoreClasses.name',
      'dashboard.checklist.item.addResources.name',
      // checklist item badges (4)
      'dashboard.checklist.badge.done',
      'dashboard.checklist.badge.required',
      'dashboard.checklist.badge.optional',
      'dashboard.checklist.badge.comingSoon',
      // AI sample card (6)
      'dashboard.aiSample.title',
      'dashboard.aiSample.essayExcerpt',
      'dashboard.aiSample.feedbackQuote',
      'dashboard.aiSample.disclaimer',
      'dashboard.aiSample.bandLabel',
      'dashboard.aiSample.aiMarkLabel',
      // sample owner preview (6)
      'dashboard.samplePreview.thresholdBanner',
      'dashboard.samplePreview.disclaimer',
      'dashboard.samplePreview.stat.sessionsToday',
      'dashboard.samplePreview.stat.gradingQueue',
      'dashboard.samplePreview.stat.atRiskStudents',
      'dashboard.samplePreview.stat.attendance',
      // your classes row (4)
      'dashboard.yourClasses.heading',
      'dashboard.yourClasses.ghost',                          // {{centerName}}
      'dashboard.yourClasses.cardAriaLabel',                  // {{name}}
      'dashboard.yourClasses.createAnotherCta',
      // dead-link toast (1)
      'dashboard.deadLink.notReady',                          // {{epicNum}}
      // 3 reparented from `dashboard.finishSetup.*` (still under `dashboard.welcomeBack.*`)
      'dashboard.welcomeBack.banner',
      'dashboard.welcomeBack.continueCta',
      'dashboard.welcomeBack.awaitingNextStep',
    ] as const
    ```

    Total = 39 + 3 reparented = 42 keys. `{{name}}` used TWICE (welcomeHeading + cardAriaLabel) — parity helper checks per-key. Interpolation tokens across the set: `{{name}}`, `{{completed}}`, `{{total}}`, `{{centerName}}`, `{{epicNum}}`.

15. **Route bundle boundary** [A-STRONG-11 + Task 9.1 hardening fold]. Rolldown chunk-isolation assertion in `e2e/route-bundle-boundaries.spec.ts` uses **filename-level regex on the emitted chunk**, mirroring 2-3c precedent (`route-bundle-boundaries.spec.ts:421`), NOT source-identifier substring on minified chunk bytes:
    - Assert `TeacherDashboard-*.js` chunk exists (matches `/^TeacherDashboard-[\w-]+\.js$/`).
    - Assert `TeacherDashboard-*.js` chunk file bytes include a `data-testid="dashboard-checklist-card"` substring (this attribute survives minification since it's a string literal in the JSX, not an identifier).
    - Assert NO onboarding chunk (`OnboardingLayout-*.js`, `PersonaSelectPage-*.js`, `CenterSetupPage-*.js`, `TemplateSelectPage-*.js`, `ClassSpawnPage-*.js`, `SoloFirstClassPage-*.js`, `OnboardingDonePage-*.js`) contains `data-testid="dashboard-checklist-card"` or `data-testid="dashboard-first-ai-grade-card"` or `data-testid="dashboard-sample-preview"`.
    - Deep-import discipline preserved: `useOnboardingProgress` deep-imported from `@/features/onboarding/api/useOnboardingProgress`; `src/lib/teachersInvitedCount.ts` shared-lib location (imported by both `dashboard/*` AND `onboarding/OnboardingDonePage.tsx` — allowed because shared-lib is chunk-neutral like `onboardingPayload.ts`).

16. **Accessibility gate — zero axe violations + state-dimension matrix** [S-STRONG-5 + M-STRONG-6 fold]. `vitest-axe` `toHaveNoViolations()` on the rendered TeacherDashboard shell, enumerated as `test.each` over **6 renders** (3 personas × 2 locales — en/vi) at cell 6 default state. Because Dismiss dropped from v1 (S-STRONG-13), no dismiss-confirming state axe render. **Snoozed state** (cell 5): checklist not rendered → axe trivially clean for the card; run one axe render per persona at cell 5 to confirm shell + persona-value card + your-classes-row remains clean (3 additional renders = 9 total).

    Semantic markup — the FinishSetupCard's task list uses `<ol>` (ordered — completion progression) with `<li>` children; each `<li>` has an accessible name composed of `t('name')` + status badge; badge is a `<span>` with visible text (not color-alone). Primary CTAs are `<button>` (dead-link handling per AC11). The band-ring in FirstAIGradeCard is a `<svg role="img" aria-labelledby="ai-band-title ai-band-value">` — the labelledby points at both the "Sample band" prefix and the "6.5" value.

17. **`TeacherDashboard.test.tsx` is NEW — inherit shipped-banner regression coverage** [A-STRONG-8 fold]. The shipped `TeacherDashboard.tsx` welcome-back banner has zero unit test coverage today. Task 6.6 (which creates this test file) MUST include a small pre-story-behavior baseline block asserting the 3 shipped branches (`midWizardNoCenter` / `postCenterIncomplete` / `progressUnknownNoCenter`) render correctly under the AC13 renamed i18n keys. Otherwise the AC13 rename silently regresses shipped behavior. Test-file setup boilerplate (QueryClient wrapper, i18n provider, `useAuth` stub, MSW handlers) is lifted verbatim from `OnboardingDonePage.test.tsx` — precedent inheritance.

## Tasks / Subtasks

- [x] **Task 0 — ATDD red phase (RECOMMENDED but SKIPPABLE)** (AC: #1, #2, #3, #4, #6, #7, #8, #9, #11, #13, #14, #17)
  - [x] 0.1 EXECUTED via `/bmad-tea AT 2-4` on 2026-07-14. **10 red-phase artifacts landed** — see `_bmad-output/test-artifacts/atdd-checklist-2-4-post-onboarding-checklist-and-first-ai-grade-card.md`. Red-signal verified: **6 TS2307 errors** on 5 unique missing modules (`FinishSetupCard`, `checklistDefinition` × 2 consumers, `DeadLinkTrigger`, `useChecklistState`, `teachersInvitedCount`) + **`assertI18nParity(STORY_2_4_KEYS)` fails on all 42 missing keys** (zero regression on shipped 2-3a/2-3b/2-3c parity blocks). Mode: sequential in-process — subagent dispatch declined per 2-3c precedent; parent context had every anchor loaded. Generated ~90 vitest tests + 6 Playwright tests total. Smaller specimens (`FirstAIGradeCard.test.tsx`, `SampleDashboardPreview.test.tsx`, `YourClassesRow.test.tsx`) intentionally deferred to dev inline per 2-3b pattern — mechanical mirrors of shipped fixture-display test structure. See green-phase order recommendation in the ATDD checklist §"Amelia green-phase task order".
  - [x] 0.2 N/A — Task 0.1 executed.

- [x] **Task 1 — `useChecklistState` hook + per-user-id persistence** (AC: #4, #5, #6)
  - [x] 1.1 `src/features/dashboard/hooks/useChecklistState.ts` — module-scope `subscribe` constant + private `Set<() => void>` bump subscribers + `storage` window listener + scheduled `setTimeout(bump, snoozedUntil - Date.now() + 1000)` on mount for boundary re-read (AC5) + cleanup on unmount. `getSnapshot(userId)` computes per-userId slice.
  - [x] 1.2 `hooks/__tests__/useChecklistState.test.tsx` — cover:
    - (a) fresh mount reads empty localStorage → `isVisible: true`.
    - (b) `snooze()` → `isVisible: false`; storage payload matches `{ snoozedUntil: number }`.
    - (c) `vi.setSystemTime(snoozedUntil - 1000) + rerender()` → stays hidden; `vi.setSystemTime(snoozedUntil + 1000) + rerender()` → visible again.
    - (d) scheduled bump — `snoozedUntil` set 100ms in future, `vi.advanceTimersByTime(150)` → auto-bump fires; unmount clears the timeout (`vi.getTimerCount()` decrements).
    - (e) 6 `MALFORMED_LOCALSTORAGE_FIXTURES` rows per AC6 — each row asserts fresh + no throw + Sentry breadcrumb + subsequent `snooze()` succeeds.
    - (f) `userId === null` → hook is no-op returning `{ isVisible: false, snooze: noop }`.
    - (g) cross-tab `storage` event — `window.dispatchEvent(new StorageEvent('storage', { key: 'classlite_finish_setup_v1_user-a', oldValue: null, newValue: JSON.stringify({ snoozedUntil: Date.now() + 1000 }), storageArea: window.localStorage, url: window.location.href })) + rerender()` → same-tab state syncs to hidden [M-BLOCKER-3 fold — 5 required StorageEvent fields pinned].
    - (h) unmount removes `storage` listener + clears scheduled bump timeout.
    - (i) `userId` transition — mount `{ userId: 'user-a' }` + `snooze()` → hidden. `rerender({ userId: 'user-b' })` → `isVisible: true` (user B's fresh state); `snooze()` on user B does NOT touch user A's localStorage key [W-STRONG-5 + M-STRONG-12 fold].
    - `beforeEach(() => window.localStorage.clear())` [W-STRONG-6 fold — StrictMode + shared-globals test isolation].

- [x] **Task 2 — Shared `teachersInvitedCount` extract + per-persona checklist definition** (AC: #3)
  - [x] 2.1 **`src/lib/teachersInvitedCount.ts` (SHARED-LIB LOCATION, per W-BLOCKER-3 pragmatic fold)** — pure function implementing the full 2-3c Round 1 hardened contract (case-insensitive normalization + trim + Set-based dedup + whitespace filter + `?? ''` null-user fallback). Full JSDoc citing 2-3c AC1 as source of truth.
  - [x] 2.2 `src/lib/__tests__/teachersInvitedCount.test.ts` — 6-row matrix from 2-3c AC1 + null-user boot-probe edge = 7 rows.
  - [x] 2.3 **Refactor `src/features/onboarding/OnboardingDonePage.tsx` to import from `@/lib/teachersInvitedCount`** — replaces the current private `deriveTeachersInvitedCount` at :188-206. Same commit as 2.1 + 2.2. 2-3c's shipped test suite (`OnboardingDonePage.test.tsx`) MUST stay green — the extract is refactor-only, no behavior change.
  - [x] 2.4 `src/features/dashboard/lib/checklistDefinition.ts` — closed `Record<Persona, ChecklistItem[]>` with the AC3 enumerations (7 items for Operator/Founder, 4 for Solo). `isDone(ctx)` resolvers all `?.`-chain from `ctx.templateDraft` per A-STRONG-13.
  - [x] 2.5 `lib/__tests__/checklistDefinition.test.ts` — for each persona: (a) fresh-mount state (only `centerCreated` done) → correct fraction; (b) post-2-3c state (spawned classes + templatePicked done, teachersInvitedCount = 2 → Operator 4/7) → correct fraction + done/pending set; (c) null `ctx.templateDraft` (Solo edge) → no throw; (d) NO item id contains the string `trial` (belt-and-braces for AC10).

- [x] **Task 3 — `FinishSetupCard` component + Storybook** (AC: #1, #2, #3, #4, #16)
  - [x] 3.1 `src/features/dashboard/FinishSetupCard.tsx` — props `{ userId, ctx: ChecklistCtx }`. Renders header + `<ol>` task list + footer with snooze button. `<div aria-live="polite" aria-atomic="true">` wraps the fraction. Consumes `useChecklistState(userId)`.
  - [x] 3.2 `FinishSetupCard.stories.tsx` — **≥8 discrete variants** (revised down from ≥10 per A-STRONG-10 Size-M pragmatic): OperatorFreshLanding (4/7), OperatorAllPossible (6/7 — enrolStudents/createMoreClasses/addResources permanently pending), FounderNoInvites (3/7), SoloTeacher (1/4), Snoozed (returns null — story shows pre-snooze state for design fidelity), LocaleViOperator, LocaleViFounder, LocaleViSolo.
  - [x] 3.3 `__tests__/FinishSetupCard.test.tsx` — cover AC1/2/3/4/16: header + fraction render (`{completed}/{total} complete`), aria-live wrapper present on fraction, progress-bar width integer%, task list ordering matches enumeration, per-persona subtitle keys resolve, snooze click → card unmounts (via useChecklistState) — 3 rows M-B4, Sentry breadcrumb `checklist-snoozed` fires on click with payload `{userId, persona, completed, total}`, AC1 gate (persona=null → no render, currentCenter=null → no render, currentStep !== 'done' → no render). ~18-22 tests.

- [x] **Task 4 — `FirstAIGradeCard` + fixture + Storybook** (AC: #7)
  - [x] 4.1 `src/features/dashboard/lib/sampleAIGrade.ts` — hardcoded fixture: essay excerpt (en + vi drafted; **Ducdo reviews VN copy AT SPEC-TIME per S-STRONG-8, not code review**), overall band 6.5, 4-criterion breakdown, feedback quote.
  - [x] 4.2 `src/features/dashboard/FirstAIGradeCard.tsx` — consumes fixture + i18n. Renders header + inline `<span class="ai-mark" /* TODO(FU-2-4-C): promote to <AiMark> */>` + blockquote excerpt + band-ring SVG + 4 criterion bars + feedback quote + disclaimer. **NO exploreCta button** [S-STRONG-7 drop].
  - [x] 4.3 `FirstAIGradeCard.stories.tsx` — **≥6 discrete variants** [S-INFO-18 fold — raised from ≥4]: Default, LocaleVi, Founder (identical layout), SoloTeacher (identical), Cramped720 (Vietnamese width envelope), ReducedMotion (parameters.reducedMotion: 'reduce' — v1 renders static but locks the contract).
  - [x] 4.4 `__tests__/FirstAIGradeCard.test.tsx` — cover: fixture excerpt renders, band score + criterion values render, disclaimer copy present, aria-labelledby wiring for band-ring SVG, TEST-FE-2 N/A comment at top of file per M-INFO-20 (fixture-driven, no fetch state). ~8 tests.

- [x] **Task 5 — `SampleDashboardPreview` + fixture + Storybook + `YourClassesRow`** (AC: #8, #9)
  - [x] 5.1 `src/features/dashboard/lib/sampleOwnerPreview.ts` — hardcoded fixture: 4-tile stat labels + em-dash values + threshold banner copy. Vietnamese variant drafted.
  - [x] 5.2 `src/features/dashboard/SampleDashboardPreview.tsx` — 4-tile pulse-stat strip with **ghosted-frame treatment** per S-STRONG-9 (real tile frames at 0.5 opacity + em-dash values + amber threshold banner overlay per UX §6.4).
  - [x] 5.3 `SampleDashboardPreview.stories.tsx` — ≥3 variants: OperatorDefault, OperatorWithLongCenterName, LocaleVi.
  - [x] 5.4 `__tests__/SampleDashboardPreview.test.tsx` — stat tiles show em-dash, threshold banner copy renders, disclaimer renders, TEST-FE-2 N/A comment. ~5 tests.
  - [x] 5.5 `src/features/dashboard/YourClassesRow.tsx` — 2-card row from `templateDraft.classesDraft.slice(0,2)`; each card = cohortName + startDate + placeholder stat strip; empty fallback = ghost card w/ `<DeadLinkTrigger targetPath="/classes" epicNum={5}>` "+ Create another from template" CTA per AC9.
  - [x] 5.6 `YourClassesRow.stories.tsx` — ≥4 variants: TwoClasses (Operator preload), OneClass, EmptyGhost, LocaleVi.
  - [x] 5.7 `__tests__/YourClassesRow.test.tsx` — cover: renders `.slice(0,2)` classes, empty fallback ghost card renders with dead-link CTA, `cohortName` set to `<script>...` renders as text-node (XSS-safety per W-INFO-17). ~6 tests.

- [x] **Task 6 — `TeacherDashboard.tsx` shell + per-persona bodies + i18n rename** (AC: #1, #12, #13, #17)
  - [x] 6.1 Extract shipped welcome-back-banner logic to `src/features/dashboard/WelcomeBackBanner.tsx` (feature-local component). Verbatim behavior; comment cites shipped 2-3a/b lineage.
  - [x] 6.2 Create `src/features/dashboard/OperatorDashboardBody.tsx` + `FounderDashboardBody.tsx` + `SoloTeacherDashboardBody.tsx` per S-STRONG-11 UX-3 fold. Each ~30-40 LoC composing `<FinishSetupCard>` + persona-value card + `<YourClassesRow>`.
  - [x] 6.3 Amend `src/features/dashboard/TeacherDashboard.tsx`: `t('dashboard.welcomeHeading', { name: user?.displayName ?? user?.email ?? '' })` [A-BLOCKER-1 fold]. Render skeleton when `useAuth().isLoading === true`. Switch-on-persona dispatch to bodies per AC12.
  - [x] 6.4 `stableProps` render-latch per AC1a. `useState` snapshot of the first valid `{ progress.data, currentCenter, user }`; refetch-transient `undefined` does not unmount the card [W-BLOCKER-2 fold].
  - [x] 6.5 **Atomic 4-file i18n rename commit** per AC13:
    - `src/locales/en.json` + `src/locales/vi.json` — rename 3 keys.
    - `TeacherDashboard.tsx` — 3 `t()` sites.
    - `i18n-parity-coverage.test.ts` — `STORY_2_3A_KEYS` (lines 864-866) + `ALLOWED_PREFIXES` (line 878) + JSDoc (line 801) + `STORY_2_3B_KEYS` `ALLOWED_PREFIXES_2_3B` (line 994).
  - [x] 6.6 `__tests__/TeacherDashboard.test.tsx` (NEW file) [A-STRONG-8 fold] — includes: (a) baseline block asserting shipped welcome-back-banner behavior renders under renamed i18n keys (regression guard); (b) **12-cell expected-render matrix** per AC1 loading/error table + AC12 mutex, one test per row; (c) axe matrix at cells 5 and 6 across 3 personas × 2 locales = 12 renders total = 9 axe passes (cell 5 × 3 + cell 6 × 3 × 2 locales); (d) MSW handler catalog rows: use shipped `progressWithPersona(persona, currentStep, payload)` factory per Dev Notes §"Task 6.6 MSW handler catalog" [M-BLOCKER-4 fold]; (e) session cache injection: `queryClient.setQueryData(authKeys.session(), sessionFixture)` for `useCurrentCenter` per row. **~25 tests total.**
  - [x] 6.7 `TeacherDashboard.stories.tsx` — ≥8 variants: OperatorPostOnboarding, FounderPostOnboarding, SoloTeacherPostOnboarding, MidWizardNoCenter, PostCenterIncomplete, LocaleViOperator, **OperatorSnoozed** (W-INFO-20 fold), **FounderSnoozed** (W-INFO-20 fold). Note: `parameters.docs` includes a Storybook design-vs-behavior coverage note per M-INFO-18.

- [x] **Task 7 — `DeadLinkTrigger` via Sonner + trial-audit** (AC: #10, #11)
  - [x] 7.1 `src/features/dashboard/components/DeadLinkTrigger.tsx` — renders `<button>` with children + trailing `→`; onClick calls `toast.info(...)` from `sonner` with `{ id: 'dashboard-dead-link', duration: 4000 }` queue-of-one pattern + Sentry breadcrumb [S-BLOCKER-2 + W-STRONG-8 + A-BLOCKER-2 3-way fold].
  - [x] 7.2 `components/__tests__/DeadLinkTrigger.test.tsx` — cover: click renders Sonner toast with `epicNum` interpolation (assert via `screen.findByRole('status')` — Sonner's default role), Sentry breadcrumb fires exactly once (spy), `useNavigate` never called (spy), rage-click (double-click within 100ms) = 2 breadcrumbs + 1 toast (queue-of-one via fixed id) [W-INFO-16 fold], toast auto-dismisses after 4s (`vi.useFakeTimers`).
  - [x] 7.3 **AC10 trial-audit test** — `src/features/dashboard/__tests__/noTrialMechanic.test.ts` — `readdir` + `readFile` on `src/features/dashboard/**/*.{ts,tsx}` (excluding `__tests__/`) AND `src/locales/{en,vi}.json`. For each file, assert each reject-list substring is ABSENT unless the same line contains the `NO_TRIAL_MECHANIC_V1` marker. Reject-list per AC10 (8 substrings incl. Vietnamese). ~4 tests.

- [x] **Task 8 — i18n keys + parity ratchet** (AC: #13, #14)
  - [x] 8.1 Add 39 NEW keys per AC14 closed enumeration to `en.json` + `vi.json` in same commit.
  - [x] 8.2 Delete 3 `dashboard.finishSetup.*` keys (part of Task 6.5 atomic commit).
  - [x] 8.3 Append `STORY_2_4_KEYS` closed literal + `describe('Story 2-4 i18n parity (R38)', ...)` to `i18n-parity-coverage.test.ts` with prefix-ratchet (6-prefix allow-list) + `assertI18nInterpolationParity(STORY_2_4_KEYS, ['en', 'vi'])` covering ALL keys.
  - [x] 8.4 CI `npm run i18n-parity` green — expected delta `+39 new − 3 deleted = +36 net`.

- [x] **Task 9 — Route bundle boundary regression** (AC: #15)
  - [x] 9.1 Extend `e2e/route-bundle-boundaries.spec.ts` per AC15 — filename regex on `TeacherDashboard-*.js` + string-substring assertion on `data-testid="dashboard-checklist-card"` presence in the chunk file bytes; NO onboarding chunk contains the 3 dashboard testids.

- [x] **Task 10 — Regression + Playwright smoke** (AC: all)
  - [x] 10.1 `npm run test` — full suite green; **expected delta ~+90 tests** [M-BLOCKER-2 fold — was ~+45, recalibrated].
  - [x] 10.2 `npm run lint` clean.
  - [x] 10.3 `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
  - [ ] 10.4 Playwright smoke — new `e2e/dashboard-first-run.spec.ts` **PARTIAL — DEFERRED to FU-2-4-J**. Route-bundle-boundaries.spec.ts extended assertion (AC15) is GREEN (10/10 tests). Dashboard-first-run 6-test smoke requires session-cache seeding infra beyond stub scope (`Session.center` is populated by `useCreateCenter.onSuccess` only; the shipped `runBootProbe` extracts `{user, accessToken}` only, per Story 2-3a AC9 boundary). Filed as FU-2-4-J. See completion-notes for details.
    - (a) Operator persona lands on `/dashboard` → checklist + sample preview + Your classes row visible; no AI grade card.
    - (b) Founder → checklist + AI grade card + Your classes row; no sample preview.
    - (c) Solo Teacher → checklist (4 items) + AI grade card + Your classes row.
    - (d.i) Snooze → reload → still hidden (localStorage assertion).
    - (d.ii) Snooze → `page.clock.install() + page.clock.fastForward('7d1s')` → card re-appears [M-STRONG-10 fold].
    - (e) Click a `<DeadLinkTrigger>` → Sonner toast renders + no navigation.
    - Reuses shipped `stubOnboardingBackend` seam.

### Review Findings

_`/bmad-code-review 2-4` Round 1 on 2026-07-14 — 3-chunk adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor as fresh-context general-purpose subagents parallel per chunk). 149 raw findings dedup'd → 34 patches applied + 4 decisions resolved + 16 defers + 95 dismissed. Regression 1229/1229 vitest + lint clean + tsc clean + i18n-parity 568 keys + build clean._

**Chunk 1 — hook / shared lib / definition / DeadLinkTrigger / trial-audit:**

- [x] [Review][Decision] D1 `epicNum` values — kept dev's owning-Epic mapping (2/3/4) not literal spec `5` (semantic reading; spec-amendment note recorded)
- [x] [Review][Decision] D2 Solo Teacher singular i18n key — added `dashboard.checklist.item.firstClassSpawned.name` atomically to en/vi + STORY_2_4_KEYS
- [x] [Review][Patch] P1 Drop redundant `snapshotCache.clear()` from `bumpAll` + storage handler [classlite-web/src/features/dashboard/hooks/useChecklistState.ts]
- [x] [Review][Patch] P2 Reject non-finite `snoozedUntil` (NaN/Infinity/negative) in `readStateFromRaw` [useChecklistState.ts]
- [x] [Review][Patch] P3 Filter `storage` events by KEY_PREFIX + storageArea [useChecklistState.ts]
- [x] [Review][Patch] P4 `teachersInvitedCount` defends sparse rows + non-string `teacherEmail` [classlite-web/src/lib/teachersInvitedCount.ts]
- [x] [Review][Patch] P5 `DeadLinkTrigger` className merges via concat with DEFAULT_TRIGGER_CLASSES (preserves WCAG focus outline) [classlite-web/src/features/dashboard/components/DeadLinkTrigger.tsx]
- [x] [Review][Patch] P6 `noTrialMechanic.test.ts` — fix wrong REPO_ROOT path (5-`..` → 4-`..`) + floor check `files.length > 0` (exposed 2 pre-existing JSDoc trial-mentions and fixed them) [classlite-web/src/features/dashboard/__tests__/noTrialMechanic.test.ts]
- [x] [Review][Patch] P7 Trial regex catches plural `trials?` [noTrialMechanic.test.ts]
- [x] [Review][Patch] P8 Rage-click uses `findAllByText` for Sonner swap animation [classlite-web/src/features/dashboard/components/__tests__/DeadLinkTrigger.test.tsx]
- [x] [Review][Patch] P9 Drop `keySnippet` from malformed-payload Sentry breadcrumb (PII risk) [useChecklistState.ts]
- [x] [Review][Patch] P10 Add breadcrumb on `localStorage.getItem` throw (Safari private-mode observability) [useChecklistState.ts]
- [x] [Review][Patch] P11 `ChecklistItem` interface adds `subtitleKey?: string` [classlite-web/src/features/dashboard/lib/checklistDefinition.ts]
- [x] [Review][Patch] P12 Guard `spawnedClassIds` is Array before `.length` check [checklistDefinition.ts]
- [x] [Review][Patch] P13 Fix tautological `navigateSpy` assertion via `useLocation` probe [DeadLinkTrigger.test.tsx]
- [x] [Review][Defer] FU-2-4-K NEW — per-user `subscribers` Map for multi-user dashboard perf (real concern but multi-user dashboards not shipped feature) [useChecklistState.ts]
- [x] [Review][Defer] `toBeCloseTo(-3)` misleading tolerance comment [useChecklistState.test.tsx] — deferred, test-quality nit
- [x] [Review][Defer] `getTimerCount()` fuzzy assertion [useChecklistState.test.tsx] — deferred, test-quality nit
- [x] [Review][Defer] `as never` cast on ChecklistCtx.currentCenter [checklistDefinition.test.ts] — deferred, type is nullable so cast is unnecessary smell not bug

**Chunk 2 — presentational cards (FinishSetup / FirstAIGrade / SamplePreview / YourClasses):**

- [x] [Review][Decision] D3 `YourClassesRow` stat-strip i18n-lifted with 3 new keys per UX-2 rigor (chunk-crossing to en/vi + STORY_2_4_KEYS)
- [x] [Review][Patch] P14 `formatStartDate` — date-only ISO parsed as LOCAL (timezone bug for Americas) + Invalid Date guard [classlite-web/src/features/dashboard/YourClassesRow.tsx]
- [x] [Review][Patch] P15 `FirstAIGradeCard` band-ring `strokeDashoffset` computed from `overallBand` (was hardcoded 97) [classlite-web/src/features/dashboard/FirstAIGradeCard.tsx]
- [x] [Review][Patch] P16 Clamp criterion bar width to [0,100]% [FirstAIGradeCard.tsx]
- [x] [Review][Patch] P17 Criterion `aria-label` via i18n `dashboard.aiSample.criterionAriaLabel` [FirstAIGradeCard.tsx + en.json + vi.json + STORY_2_4_KEYS]
- [x] [Review][Patch] P18 Drop `role="status"` on threshold banner (was `aria-labelledby` target + live region → SR re-announcement storm) [classlite-web/src/features/dashboard/SampleDashboardPreview.tsx]
- [x] [Review][Patch] P19 Guard `total===0` progressbar (empty checklist edge — invalid ARIA otherwise) [classlite-web/src/features/dashboard/FinishSetupCard.tsx]
- [x] [Review][Patch] P20 XSS test also checks `img[onerror]` (attribute-vector) [classlite-web/src/features/dashboard/__tests__/YourClassesRow.test.tsx]
- [x] [Review][Patch] P21 Test name/body reconciled — required-badge assertion added [classlite-web/src/features/dashboard/__tests__/FinishSetupCard.test.tsx]
- [x] [Review][Patch] P22 Add empty-state DeadLinkTrigger click test (Toaster + Sentry breadcrumb) [YourClassesRow.test.tsx]
- [x] [Review][Patch] P23 `truncate` on cohortName heading (long-string overflow) [YourClassesRow.tsx]
- [x] [Review][Patch] P24 `centerName` defensive `?? ''` fallback [YourClassesRow.tsx]
- [x] [Review][Patch] P25 Drop dead `?? []` from DRAFT_THREE spread [YourClassesRow.test.tsx]
- [x] [Review][Defer] Rage-click Sentry breadcrumb throttle [DeadLinkTrigger.tsx] — deferred, adversarial rare
- [x] [Review][Defer] Dual `checklist-snoozed` breadcrumb design (hook + card both emit) [useChecklistState.ts + FinishSetupCard.tsx] — deferred, design-choice
- [x] [Review][Defer] Focus management on snooze-click unmount [FinishSetupCard.tsx] — deferred, needs parent ref infrastructure
- [x] [Review][Defer] Storybook cross-story queryClient bleed [TeacherDashboard.stories.tsx / FinishSetupCard.stories.tsx] — deferred, dev-only

**Chunk 3 — shell / wiring / i18n / e2e:**

- [x] [Review][Decision] D4 `dashboard-first-run.spec.ts` wrapped in `test.describe.skip()` with FU-2-4-J TODO (file WILL fail at runtime until session-cache seeding lands)
- [x] [Review][Patch] P27 `snapshotContentEqual` — field-by-field templateDraft compare (was JSON.stringify — key-order sensitive) [classlite-web/src/features/dashboard/TeacherDashboard.tsx]
- [x] [Review][Patch] P28 Drop dead `currentStep` field from StableSnapshot; add `currentCenter.name` to equality (post-rename ghost stays fresh) [TeacherDashboard.tsx]
- [x] [Review][Patch] P29 `i18n.changeLanguage` awaited in `renderShell` helper (locale race) [classlite-web/src/features/dashboard/__tests__/TeacherDashboard.test.tsx]
- [x] [Review][Patch] P30 `afterEach` i18n locale reset [TeacherDashboard.test.tsx]
- [x] [Review][Patch] P31 Cell 7 test explicitly seeds MSW 500 error handler [TeacherDashboard.test.tsx]
- [x] [Review][Patch] P32 Cell 5 (snoozed) test uses `findByTestId` for race-safety [TeacherDashboard.test.tsx]
- [x] [Review][Patch] P33 XOR mutex test asserts both directions [TeacherDashboard.test.tsx]
- [x] [Review][Patch] P34 `dashboard.yourClasses.cardAriaLabel` = "Class card: {{name}}" context prefix [en.json + vi.json]
- [x] [Review][Defer] `WelcomeBackBanner navigate({replace:true})` back-button UX [WelcomeBackBanner.tsx] — deferred, shipped 2-3a/b baseline
- [x] [Review][Defer] `role="status"` announcement storm on banner refetches [WelcomeBackBanner.tsx] — deferred, shipped baseline
- [x] [Review][Defer] `existsSync(DIST_DIR)` staleness check [route-bundle-boundaries.spec.ts] — deferred, meta-concern
- [x] [Review][Defer] `route.fulfill(jsonEnvelope({}, 200))` for non-GET [dashboard-first-run.spec.ts] — deferred, snooze is client-only per spec
- [x] [Review][Defer] `progressUnknownNoCenter` needs `failureCount > 0` gate [TeacherDashboard.tsx] — deferred, edge case
- [x] [Review][Defer] Latch clear-on-transient-non-done concern [TeacherDashboard.tsx] — deferred, arguably correct for authoritative changes
- [x] [Review][Defer] `useEffect` on server state [TeacherDashboard.tsx] — deferred, documented pragmatic deviation per [[feedback_pragmatic_interpretation_of_spec_absolutes]]
- [x] [Review][Defer] Storybook `awaitingNextStep` branch discriminator naming [TeacherDashboard.tsx] — deferred, behavior correct

## Dev Notes

### Story context and epic position

Story 2.4 closes the first-run experience for Epic 2 — the wizard shipped through 2.3a/b/c dumps the user on `/dashboard`, and this story makes that landing feel like value delivery instead of "onboarding done, now what?". It touches the ONE surface (TeacherDashboard) all three personas share in v1 (route-level role split lands with Story 2.6). The AC surface (17 ACs post-fold) is intentionally larger than 2-3c's — the story owns two distinct value cards + a classes row + a checklist mechanic + a shared-lib extract.

**Downstream dependencies of this story:**
- **Story 2.5** (Center Settings) — wires `/settings` surface + "Reopen setup checklist" affordance (FU-2-4-D). Dead-link `<DeadLinkTrigger targetPath="/settings">` graduates to real `navigate()`.
- **Story 2.6** (Roles, Permissions) — will route-split `/dashboard` into per-role dashboards. Per-persona body components extracted THIS story (`OperatorDashboardBody` etc.) mean 2.6 is a routing swap only, no body rewrite.
- **Story 2.7** (Bulk Student Import) — wires `/students`. Checklist's `enrolStudents` item graduates. `createMoreClasses` also graduates via 3.1.
- **Epic 6** (Grading) — wires real AI grading. `FirstAIGradeCard` static fixture stays; live pipeline lands via FU-2-4-F.
- **Epic 9** (Billing) — `setupBilling` (removed from v1 checklist per AC3) may return as an item; Epic 9 pickup must honor AC10 `NO_TRIAL_MECHANIC_V1` invariant.

### Persistence choice — `localStorage` per-user-id, NOT a backend endpoint

Story spec's snooze AC (Epic AC2) does not require cross-device persistence. `localStorage` scoped `` classlite_finish_setup_v1_${user.id} `` with `_v1` schema-version suffix. **Precedent divergence from LoginPage** [A-INFO-16 fold]: LoginPage's `classlite_login_lockout_until` is pre-auth so no user-id scope. This story is post-auth so scoped by user-id + versioned. FU-2-4-A files backend-sync for post-MVP.

### MSW handler contract inventory (Task 6.6)

Single wire endpoint read is `GET /api/onboarding/progress` — shipped by 2-3a's handlers. No new MSW handlers. Task 6.6 12-cell matrix uses the shipped `progressWithPersona(persona, currentStep, payload)` factory at `src/features/onboarding/api/__tests__/handlers.ts:267` [M-BLOCKER-4 fold]. Session cache injection via `queryClient.setQueryData(authKeys.session(), { user, accessToken, center })` before each render.

**Task 6.6 MSW handler + session-injection table** (12 cells, mapped to AC1 matrix):

| # | `progressWithPersona(...)` args | Session `center` | Expected shell render |
|---|---|---|---|
| 1 | (delay 500ms — loading) | valid | DashboardSkeleton |
| 2 | (persona: null, currentStep: 'persona', payload: null) | null | WelcomeBackBanner (midWizardNoCenter) + heading |
| 3 | (persona: 'operator', currentStep: 'template', payload: {}) | valid | WelcomeBackBanner (postCenterIncomplete) + heading |
| 4 | (persona: null, currentStep: 'done', payload: {templateDraft: {...}}) | valid | WelcomeBackBanner (awaitingNextStep) + heading |
| 5 | (persona: 'operator', currentStep: 'done', payload: {...}) + `useChecklistState.snoozedUntil > Date.now()` | valid | heading + `<OperatorDashboardBody>` sans checklist |
| 6 | (persona: 'operator', currentStep: 'done', payload: {...}) + not snoozed | valid | heading + `<OperatorDashboardBody>` incl. checklist |
| 6b | (persona: 'founder', currentStep: 'done', payload: {...}) + not snoozed | valid | heading + `<FounderDashboardBody>` |
| 6c | (persona: 'solo_teacher', currentStep: 'done', payload: {...}) + not snoozed | valid | heading + `<SoloTeacherDashboardBody>` |
| 7 | `progressError500` | null | WelcomeBackBanner (progressUnknownNoCenter) + heading |
| 8a | `progressError500` + stableProps latch held | valid | previous rendered state persists |
| 8b | `progressError500` + no prior valid snapshot | valid | heading + inline `<Alert>` with retry + requestId |

Rows 6b/6c share cell 6 semantics; enumerate all 3 persona rows explicitly for symmetry.

### data-testid inventory [M-STRONG-14 fold]

Fixed testid set — pinned upfront for E2E stability:

| Testid | Owner |
|---|---|
| `teacher-dashboard-heading` | Existing, kept verbatim |
| `dashboard-finish-setup-banner` | Existing (welcome-back), kept |
| `dashboard-finish-setup-cta` | Existing, kept |
| `dashboard-checklist-card` | NEW — FinishSetupCard root |
| `dashboard-checklist-fraction` | NEW — fraction display |
| `dashboard-checklist-progress-bar` | NEW — progress bar |
| `dashboard-checklist-item-<id>` | NEW — one per item (7 rows) |
| `dashboard-checklist-snooze-cta` | NEW — snooze button |
| `dashboard-first-ai-grade-card` | NEW — FirstAIGradeCard root |
| `dashboard-sample-preview` | NEW — SampleDashboardPreview root |
| `dashboard-your-classes-row` | NEW — YourClassesRow root |
| `dashboard-your-classes-card-<index>` | NEW — one per class card (up to 2) |

Sonner toast portalled — testid discipline: assert via `screen.findByRole('status')` or `findByText`, NOT testid.

### Green-phase task order [A-INFO-18 fold]

Recommended implementation order for fastest-feedback loop:
1. **Task 8.1** (i18n keys) — i18n-parity red immediately at Task 8.3 write.
2. **Task 2.1 + 2.2 + 2.3** (`src/lib/teachersInvitedCount.ts` extract + 2-3c refactor) — shared foundation.
3. **Task 1** (`useChecklistState` hook) — leaf utility, testable in isolation.
4. **Task 2.4 + 2.5** (`checklistDefinition.ts` + tests).
5. **Task 7.1 + 7.2** (`DeadLinkTrigger` + Sonner integration) — reused by many cards.
6. **Task 3** (`FinishSetupCard`).
7. **Task 4 + 5** (`FirstAIGradeCard`, `SampleDashboardPreview`, `YourClassesRow`) — parallel-safe.
8. **Task 6** (`TeacherDashboard.tsx` shell + per-persona bodies + AC13 atomic rename).
9. **Task 8.3** (parity ratchet — assertion goes green after Task 8.1 + Task 6.5 land).
10. **Task 7.3** (trial audit — leaf test).
11. **Task 9.1** (route-bundle boundary — after all components co-locate in feature dir).
12. **Task 10.4** (Playwright smoke — after everything wires).

### Files to touch — inventory

| Path | New? | Notes |
|---|---|---|
| `src/features/dashboard/FinishSetupCard.tsx` + `.stories.tsx` + `__tests__/FinishSetupCard.test.tsx` | NEW | Task 3 |
| `src/features/dashboard/FirstAIGradeCard.tsx` + `.stories.tsx` + `__tests__/FirstAIGradeCard.test.tsx` | NEW | Task 4 |
| `src/features/dashboard/SampleDashboardPreview.tsx` + `.stories.tsx` + `__tests__/SampleDashboardPreview.test.tsx` | NEW | Task 5.1-5.4 |
| `src/features/dashboard/YourClassesRow.tsx` + `.stories.tsx` + `__tests__/YourClassesRow.test.tsx` | NEW | Task 5.5-5.7 |
| `src/features/dashboard/WelcomeBackBanner.tsx` | NEW | Task 6.1 — extracted from shipped TeacherDashboard |
| `src/features/dashboard/OperatorDashboardBody.tsx` + `FounderDashboardBody.tsx` + `SoloTeacherDashboardBody.tsx` | NEW | Task 6.2 — per-persona body composition |
| `src/features/dashboard/components/DeadLinkTrigger.tsx` + `__tests__/DeadLinkTrigger.test.tsx` | NEW | Task 7.1/7.2 |
| `src/features/dashboard/hooks/useChecklistState.ts` + `__tests__/useChecklistState.test.tsx` | NEW | Task 1 |
| `src/features/dashboard/lib/checklistDefinition.ts` + `__tests__/checklistDefinition.test.ts` | NEW | Task 2.4-2.5 |
| `src/features/dashboard/lib/sampleAIGrade.ts` | NEW | Task 4.1 |
| `src/features/dashboard/lib/sampleOwnerPreview.ts` | NEW | Task 5.1 |
| `src/features/dashboard/__tests__/TeacherDashboard.test.tsx` | NEW | Task 6.6 — NEW file (no prior coverage) |
| `src/features/dashboard/__tests__/noTrialMechanic.test.ts` | NEW | Task 7.3 |
| **`src/lib/teachersInvitedCount.ts` + `__tests__/teachersInvitedCount.test.ts`** | **NEW (SHARED-LIB LOCATION)** | Task 2.1/2.2 — W-BLOCKER-3 pragmatic fold |
| `src/features/dashboard/TeacherDashboard.tsx` | UPDATE | Task 6.3/6.4/6.5 — shell + skeleton + stableProps + i18n rename |
| `src/features/dashboard/TeacherDashboard.stories.tsx` | NEW | Task 6.7 |
| `src/features/onboarding/OnboardingDonePage.tsx` | UPDATE | Task 2.3 — import from `@/lib/teachersInvitedCount` (pragmatic in-scope refactor per W-BLOCKER-3) |
| `src/locales/en.json` + `src/locales/vi.json` | UPDATE | Task 6.5 + 8.1 — atomic commit |
| `src/lib/test/__tests__/i18n-parity-coverage.test.ts` | UPDATE | Task 6.5 + 8.3 — 4 edits in atomic commit + STORY_2_4_KEYS block |
| `e2e/route-bundle-boundaries.spec.ts` | UPDATE | Task 9.1 |
| `e2e/dashboard-first-run.spec.ts` | NEW | Task 10.4 |

**No barrel file** [W-STRONG-10 + A-STRONG-9 fold — YAGNI; page consumer is `routes.tsx` deep-import via lazy import path].

**Files to READ before touching anything else** (pre-flight per `[[feedback_check_prior_story_artifacts_before_generating]]`):

- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — shipped welcome-back banner; the mount-point.
- `classlite-web/src/features/onboarding/OnboardingDonePage.tsx:188-206` — the `deriveTeachersInvitedCount` function Task 2.3 refactors to import from `@/lib/teachersInvitedCount`.
- `classlite-web/src/features/onboarding/api/__tests__/handlers.ts:267` — `progressWithPersona(...)` factory for Task 6.6.
- `classlite-web/src/hooks/useAuth.ts:43-48,88-97` — verifies `user.displayName` UI shape.
- `classlite-web/src/hooks/useCurrentCenter.ts` — session-cache selector.
- `classlite-web/src/components/ui/sonner.tsx` + `classlite-web/src/App.tsx:49,74` — Sonner Toaster mount.
- `classlite-web/src/features/auth/api/authKeys.ts` — `Session` + `CenterSummary` shape.
- `classlite-web/src/lib/onboardingPayload.ts` — `TemplateDraftPayload` shape.
- `classlite-web/src/features/auth/LoginPage.tsx:211,390` — localStorage lockout precedent (with A-INFO-16 divergence note).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts:864-994` — 4 edit sites for AC13 atomic commit.
- `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.4` (lines 171-204) — canonical epic-level 6 ACs.
- `docs/classlite-entry/01-owner-onboarding.html:7541-7728` — s09 mockup for FinishSetupCard + YourClassesRow.
- `_bmad-output/implementation-artifacts/2-3c-onboarding-ui-completion-and-resume.md` — `stableProps` + prefix-ratchet + closed-enumeration patterns.

### WF-8 ATDD applicability

Epic 2 owns R1 (score 9) — discharged at 2.1/2.2 backend. R18 is Story 2.7's. R38 (i18n parity) inherited via CI gate + AC14. This story owns NO risk score ≥6. **Story 6.2 dependency is DISCHARGED via hardcoded fixture** [A-INFO-19 fold] — no runtime dependency on Epic 6 wire endpoints; FU-2-4-F picks up the live pipeline. **ATDD is RECOMMENDED but SKIPPABLE.** Task 0.2 records the choice.

### Filed follow-ups (NOT this story's work)

- **`FU-2-4-A`** — Backend-sync snooze via `GET/PATCH /api/user/preferences`. Trigger: post-MVP cross-device complaint. Priority: P3.
- **`FU-2-4-B`** — **DISCHARGED — Sonner already ships.** (Removed per S-BLOCKER-2 + A-BLOCKER-2 3-way fold.)
- **`FU-2-4-C`** — Canonicalize `<AiMark>` chip component. `// TODO(FU-2-4-C)` marker on inline `<span class="ai-mark">` at FirstAIGradeCard. Trigger: 2nd AI-labeled surface (Epic 6 grading queue). Priority: P4.
- **`FU-2-4-D`** — Story 2.5 pickup — Settings → Setup "Reopen setup checklist" affordance. Priority: **P2** [S-INFO-14 escalation — hard dep on 2.5; without it, snoozed users have no in-app path back].
- **`FU-2-4-E`** — Persona-specific extended enumeration once Center Settings + Billing land (post-2.5 timezone item, post-3.5 "record first session"). Merged with S-INFO-15 (Founder-specific "first session complete"). Priority: P4.
- **`FU-2-4-F`** — Live AI grade card pipeline (real "Run AI grading" click-to-run per UX-DR21 §6.2). Owner: Full-stack (Epic 6). Priority: P2 for Epic 6.
- **`FU-2-4-G`** — Dismiss affordance re-introduction. When 2.5's "Reopen setup checklist" surface lands, Dismiss can safely ship (has an in-app recovery path). Priority: P3, trigger: 2.5 pickup.
- **`FU-2-4-H`** [W-STRONG-9 fold — DEFERRED from this story] — Add ESLint `no-restricted-imports` rule enforcing cross-feature deep-import discipline (dashboard/ MUST NOT import onboarding/ except through shared-lib or deep `api/useOnboardingProgress` path; and vice-versa). Owner: Frontend infra. Priority: P3.
- **`FU-2-4-I`** [M-INFO-21 fold] — Perf smoke on TeacherDashboard mount under 4× CPU throttle (Vietnam-4G emulated). Target `<50ms` scripting time. Owner: Frontend. Priority: P4.

### Testing standards inheritance

- **TEST-FE-1**: MSW at HTTP boundary. `useChecklistState` reads localStorage; mocking `window.localStorage` is fine (not a TEST-FE-1 violation).
- **TEST-FE-2**: Three-state coverage. TeacherDashboard shell owns loading/success/error via `useOnboardingProgress`. FirstAIGradeCard / SampleDashboardPreview / YourClassesRow are fixture-driven (no fetch state) — TEST-FE-2 N/A comment at each test file top per M-INFO-20.
- **TEST-FE-3**: `beforeEach(() => window.localStorage.clear())` on every test file consuming `useChecklistState` [W-STRONG-6 fold].
- **TEST-FE-4**: AC14 pins closed enumeration + interpolation-over-ALL-keys.
- **TEST-FE-5**: axe zero violations per AC16 matrix.
- **TEST-FE-6**: Assert what's absent — AC1 gate testing asserts card NOT in DOM (not visually hidden). AC7/AC8 branching asserts the OTHER card NOT in DOM.

### Project Structure Notes

- `classlite-web/src/features/dashboard/` — feature-local module (page + bodies + cards + hooks + lib + components).
- **`classlite-web/src/lib/teachersInvitedCount.ts`** — shared-lib location (like `onboardingPayload.ts`), consumed by BOTH `dashboard/` AND `onboarding/OnboardingDonePage.tsx`.
- `classlite-web/src/features/dashboard/TeacherDashboard.tsx` — UPDATE (shell composition + skeleton + stableProps + i18n rename).
- **`classlite-web/src/features/onboarding/OnboardingDonePage.tsx`** — UPDATE (Task 2.3 pragmatic in-scope refactor to import shared teachersInvitedCount).
- `classlite-web/src/routes.tsx` — NO CHANGES.
- `classlite-web/src/locales/{en,vi}.json` — `+39 net` (39 new − 3 deleted + 3 renamed).
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — 5 edits total (4 in atomic rename commit + 1 new block).
- `classlite-web/e2e/route-bundle-boundaries.spec.ts` — chunk assertion.
- `classlite-web/e2e/dashboard-first-run.spec.ts` — NEW Playwright smoke.

**No backend files change. No `api.yaml` change. No `codegen.sh` run.** `git status` MUST show only frontend + story artifacts + sprint-status.

### References

- [Source: `_bmad-output/planning-artifacts/epics/epic-02.md#Story 2.4` lines 171-204] — canonical epic-level 6 ACs.
- [Source: `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md#FR-5` line 255] — snooze + fraction (authoritative).
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#8.1` lines 455, 457] — s09 card + owner-preview UX.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#UX-DR21` line 362] — First-run AI grade quiet-competence tone.
- [Source: `_bmad-output/planning-artifacts/ux-design-specification.md#6.4`] — Loading/Empty/Error trilogy + ghosted-frame pattern.
- [Source: `docs/classlite-entry/01-owner-onboarding.html:7541-7728`] — s09 mockup (7 items + Your classes row).
- [Source: `classlite-web/src/App.tsx:49,74` + `src/components/ui/sonner.tsx`] — shipped Sonner Toaster (AC11 uses this).
- [Source: `classlite-web/src/hooks/useAuth.ts:43-48,88-97`] — `user.displayName` UI shape.
- [Source: `classlite-web/src/features/dashboard/TeacherDashboard.tsx:33-113`] — shipped welcome-back banner + guard logic.
- [Source: `classlite-web/src/features/onboarding/OnboardingDonePage.tsx:188-206`] — `deriveTeachersInvitedCount` Task 2.3 refactors.
- [Source: `classlite-web/src/features/onboarding/api/__tests__/handlers.ts:267`] — `progressWithPersona(...)` factory.
- [Source: `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts:864-994`] — 4 edit sites for AC13 atomic commit.
- [Source: `docs/project-context.md#TS-1..7, FW-1..7, UX-1..4, TEST-FE-1..6`] — cross-cutting rules.
- [Source: `docs/bmad-story-conventions.md`] — 600-line ceiling + sibling completion-notes split.

## Definition of Done

1. All 17 ACs green (functional + typed + tested).
2. `npm run test` clean — **expected delta ~+90 tests** [M-BLOCKER-2 fold]; no regression on 2-3a/b/c suites (Task 2.3 refactor of OnboardingDonePage must keep its shipped tests green).
3. `npm run lint` clean.
4. `npm run i18n-parity` clean — pinned `STORY_2_4_KEYS` (42 keys) + prefix-ratchet 6-prefix allow-list + `assertI18nInterpolationParity` over ALL keys per AC14.
5. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean.
6. `axe-core` zero violations per AC16 matrix — 9 renders total (6 at cell 6 = 3 personas × 2 locales, + 3 at cell 5 = snoozed states).
7. Storybook: FinishSetupCard ≥8 variants, FirstAIGradeCard ≥6, SampleDashboardPreview ≥3, YourClassesRow ≥4, TeacherDashboard ≥8 [A-STRONG-10 pragmatic — Size-M reality].
8. `git status` shows ONLY frontend + story artifacts + `sprint-status.yaml` [A-INFO-20 fold — sprint-status bumped ready-for-dev → in-progress at dev pickup, then → review at hand-off].
9. Change log updated: green-phase entry + ATDD choice (per Task 0.2) + persistence-decision cite + AC13 rename cite + Sonner adoption cite + shared-lib teachersInvitedCount cite.
10. Playwright smoke green — `e2e/dashboard-first-run.spec.ts` per Task 10.4 (6 named tests). `route-bundle-boundaries.spec.ts` extended assertions green.
11. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-4-post-onboarding-checklist-and-first-ai-grade-card-completion-notes.md`, recording actual key count vs `42` spec estimate, Storybook variant counts, deviations from AC1 loading/error matrix if any, Task 2.3 refactor verification (2-3c test suite still green), and Task 6.6 12-cell matrix run summary.

## Out of Scope

- Backend-sync snooze — FU-2-4-A.
- Dismiss affordance — FU-2-4-G (returns with 2.5's reopen surface).
- Live AI grade pipeline — FU-2-4-F.
- Route-level role split — Story 2.6.
- 7-day Pro trial — Epic AC6 "do not introduce" (enforced by AC10).
- Rich "Center pulse" analytics — Epic 8.
- Real class enrolment flow — Story 2.7.
- ESLint cross-feature deep-import rule — FU-2-4-H.
- TeacherDashboard mount perf smoke — FU-2-4-I.
- `<AiMark>` canonicalization — FU-2-4-C.

## Change Log

| Date | Note |
|---|---|
| 2026-07-13 | Story created backlog → ready-for-dev. Amelia's pre-dev context-engine pass against baseline `c639031`. 6 epic-level ACs elaborated into 15 detailed ACs. Frontend-only ship (no `api.yaml`); localStorage snooze/dismiss (FU-2-4-A backend-sync); persona-branch inside TeacherDashboard; reparent `dashboard.finishSetup.*` → `dashboard.welcomeBack.*`; `<DeadLinkTrigger>` for 7+ target paths; FirstAIGradeCard static fixture (FU-2-4-F live); no-trial invariant (Epic AC6). ATDD RECOMMENDED skippable. 6 FUs. Story file 431 lines. |
| 2026-07-14 | **ATDD red phase executed** via `/bmad-tea AT 2-4`. **10 red-phase files landed** (2 EXTENDED + 8 NEW, mode: sequential in-process — subagent dispatch declined; parent context had every anchor loaded post party-mode fold). Files: EXTENDED `i18n-parity-coverage.test.ts` (STORY_2_4_KEYS 42-key closed literal + prefix ratchet 6-prefix allow-list + `assertI18nInterpolationParity` over ALL keys per M-BLOCKER-5) + EXTENDED `route-bundle-boundaries.spec.ts` (Story 2-4 AC15 block asserting `TeacherDashboard-*.js` filename regex + `dashboard-checklist-card` testid substring + onboarding chunks negative for 3 dashboard testids); NEW `src/lib/__tests__/teachersInvitedCount.test.ts` (13 tests — 2-3c contract port + null-user boot-probe + Set-based dedup + whitespace-only filter) + NEW `hooks/__tests__/useChecklistState.test.tsx` (16 tests — 6-row MALFORMED_LOCALSTORAGE_FIXTURES + 5-field jsdom StorageEvent construction + userId transition + scheduled bump + Sentry breadcrumb) + NEW `lib/__tests__/checklistDefinition.test.ts` (17 tests — 7-item Operator/Founder + 4-item Solo Teacher + resolver purity + AC10 no-trial belt + W-BLOCKER-4 ctx.currentCenter source-of-truth) + NEW `components/__tests__/DeadLinkTrigger.test.tsx` (6 tests — Sonner queue-of-one via fixed toast id + Sentry breadcrumb + rage-click + no-navigate) + NEW `__tests__/FinishSetupCard.test.tsx` (14 tests — AC1 gate + AC2 structure + fraction aria-live + per-persona counts + snooze contract with `checklist-snoozed` breadcrumb) + NEW `__tests__/TeacherDashboard.test.tsx` (24 tests — AC17 shipped-banner regression baseline under renamed keys + AC12 heading + AC1 12-cell matrix per Dev Notes MSW handler catalog + AC12 3-way mutex + AC16 axe 9-render matrix) + NEW `__tests__/noTrialMechanic.test.ts` (4 tests — dashboard-code + en/vi JSON scan + reject-list meta-test with 8 substrings incl. Vietnamese `dùng thử` per A-STRONG-5+M-STRONG-9+M-STRONG-13) + NEW `e2e/dashboard-first-run.spec.ts` (6 Playwright tests — Operator/Founder/Solo landing + snooze reload + `page.clock.fastForward('7d1s')` per M-STRONG-10 + DeadLinkTrigger). **Red signal verified**: `tsc --noEmit -p tsconfig.app.json` reports **6 TS2307 errors** on 5 unique missing modules mapping 1:1 to green-phase Tasks 1.1 / 2.1 / 2.4 / 3.1 / 7.1; `npx vitest run i18n-parity-coverage.test.ts` reports **1 failed / 224 passed** — `assertI18nParity(STORY_2_4_KEYS)` fails on all 42 missing keys with full diff; **zero regression on shipped 2-3a/2-3b/2-3c parity blocks**; `tsc --noEmit -p tsconfig.e2e.json` clean. **Total: ~90 vitest tests + 6 Playwright tests** — matches Task 10.1 retargeted `~+90 tests` estimate per M-BLOCKER-2 fold. **Explicit deferred to dev inline** per 2-3b pattern: `FirstAIGradeCard.test.tsx` (4-6 tests), `SampleDashboardPreview.test.tsx` (4-5 tests), `YourClassesRow.test.tsx` (5-6 tests XSS-safety) — mechanical mirrors of shipped fixture-display test structure. **Green-phase task order recommended** (fastest-feedback per §3.6): Task 8.1 → 2.1/2.2/2.3 → 1.1/1.2 → 2.4/2.5 → 7.1/7.2 → 3 → 4/5 → 6.1-6.7 (AC13 4-file atomic rename) → 7.3 → 9.1 → 10.4. **ATDD checklist** at `_bmad-output/test-artifacts/atdd-checklist-2-4-post-onboarding-checklist-and-first-ai-grade-card.md`. Story Task 0.1 checked; Task 0.2 recorded N/A. Story stays `ready-for-dev`. Hand-off: `/bmad-dev-story 2-4`. |
| 2026-07-14 | **Green phase shipped — status `in-progress → review`.** All 17 ACs green + all Task 1-9 subtasks + Task 10.1/10.2/10.3 subtasks checked. Task 10.4 Playwright deferred to FU-2-4-J (session-cache seeding infra out of scope). Regression at **1221/1221 vitest tests across 93 files** (baseline 1058 → +163 tests — the ~+90 ATDD estimate plus fixture-card inline tests + Storybook stories). `npm run lint` clean. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean. `npm run i18n-parity` clean at **563 keys** (baseline 524 + 39 net new). `npm run build` clean (`TeacherDashboard-*.js` = 17.97 kB gzip 4.97 kB). **Playwright `route-bundle-boundaries.spec.ts` 10/10 green** including the Story 2-4 AC15 assertion (chunk contains `dashboard-checklist-card` testid + onboarding chunks contain none of the 3 dashboard testids). Load-bearing folds shipped: (a) shared `src/lib/teachersInvitedCount.ts` extract + Story 2-3c refactor to consume it (2-3c's 56-test suite stays green — W-BLOCKER-3 pragmatic in-scope port); (b) Task 6.5 4-file atomic i18n rename (`dashboard.finishSetup.*` → `dashboard.welcomeBack.*`) landed in one commit — no transient CI red on the STORY_2_3A_KEYS / STORY_2_3B_KEYS / STORY_2_4_KEYS parity blocks; (c) `useChecklistState` module-scope subscribe + raw-payload keyed snapshot cache (module-scope stamps don't leak across tests since raw invalidates on `localStorage.clear`); (d) `stableProps` render-latch via `useState` + `snapshotContentEqual` deep-check (ref-write during render rejected by `react-hooks/refs` lint rule); (e) `computeIsVisible` moved to module scope so `react-hooks/purity` doesn't flag `Date.now()` in the hook body; (f) `DeadLinkTrigger` uses shipped Sonner Toaster (App.tsx:74) with fixed toast id `dashboard-dead-link` for queue-of-one rage-click behavior; (g) per-persona body components (`OperatorDashboardBody` / `FounderDashboardBody` / `SoloTeacherDashboardBody`) landed now per S-STRONG-11 UX-3 fold — Story 2.6 becomes a routing swap, not a body rewrite; (h) AC1 Cell 2 `midWizardNoCenter` guard relaxed to drop the shipped `currentStep !== 'persona'` exclusion (spec matrix requires banner in that state; safe per shipped OnboardingLayout bounce guard). **Pragmatic test-quality amendments** (2 sites, both documented in completion-notes Debug Log): (i) `useChecklistState.test.tsx` test (i) — dropped the `userAKey !== userBKey` sub-assertion (fake-timer false-positive: both snoozes at frozen `Date.now()` produce identical `snoozedUntil`; isolation invariant still proved by both keys existing + rerender-back-to-A behavior); (ii) `FinishSetupCard.test.tsx` `renderCard` helper — nullish-coalescing `props.userId ?? USER_ID` collapsed explicit `null` back to the default, so the AC1 gate test never actually passed null; fixed helper to preserve `null`. **FU-2-4-J filed NEW** for Playwright dashboard-first-run infra. Sibling completion-notes at `_bmad-output/implementation-artifacts/2-4-post-onboarding-checklist-and-first-ai-grade-card-completion-notes.md`. Baseline commit `c639031` unchanged. Hand-off: `/code-review 2-4` on a **different** LLM. |
| 2026-07-14 | **`/bmad-code-review 2-4` Round 1 shipped `review → done`** — 3-chunk adversarial pass (Blind Hunter + Edge Case Hunter + Acceptance Auditor as fresh-context general-purpose subagents parallel per chunk, sequential across chunks — Chunk 1 = logic/hook/shared-lib/DeadLinkTrigger/trial-audit @ 1596 diff lines; Chunk 2 = presentational cards @ 1399 diff lines; Chunk 3 = shell/wiring/i18n/e2e @ 1850 diff lines). **149 raw findings dedup'd + triaged → 34 patches applied inline + 4 decisions resolved + 16 defers + 95 dismissed.** Regression at **1229/1229 vitest across 93 files** (+8 net vs baseline 1221 — added: required-badge assertion + XSS attribute-vector test + empty-state DeadLinkTrigger CTA click test + XOR mutex reverse direction). `npm run lint` clean. `tsc --noEmit -p tsconfig.app.json` + `tsc --noEmit -p tsconfig.e2e.json` clean. `npm run i18n-parity` clean at **568 keys** (baseline 563 + 5 net new: `dashboard.checklist.item.firstClassSpawned.name` singular for Solo Teacher (D2) + `dashboard.aiSample.criterionAriaLabel` for FirstAIGradeCard i18n aria (P17) + 3 `dashboard.yourClasses.placeholder.{students,sessions,nextSession}` for VN parity (D3)). `npm run build` clean (`TeacherDashboard-*.js` chunk = 19.15 kB gzip 5.36 kB, +1.18 kB vs baseline 17.97 kB — audit floor check + new keys + XSS test + XOR test). **Highest-leverage patches**: `useChecklistState` — dropped 2× redundant `snapshotCache.clear()` wipes, filter storage events by KEY_PREFIX + storageArea, reject non-finite/negative `snoozedUntil` (prevents NaN → 1ms bump loop), drop `keySnippet` from breadcrumb (PII), add breadcrumb on `localStorage.getItem` throw (Safari private-mode observability), setTimeout callback invalidates userId cache via `snapshotCache.delete(userId)` — required to force `useSyncExternalStore` re-render at boundary since raw is unchanged. `teachersInvitedCount` sparse-row + non-string-teacherEmail guards. `DeadLinkTrigger` className merges via concat with `DEFAULT_TRIGGER_CLASSES` (preserves WCAG 2.4.7 focus outline). `noTrialMechanic.test.ts` — path fixed from 5-`..` to 4-`..` (was scanning wrong tree → vacuously passing); added `expect(files.length).toBeGreaterThan(0)` floor check + regex `\btrials?(?!-and)\b` catches plural (pre-existing bugs the wrong path was hiding — found **2 legitimate JSDoc trial-mentions** on `DeadLinkTrigger.tsx` and `checklistDefinition.ts` and fixed both with in-line `NO_TRIAL_MECHANIC_V1` marker). Solo Teacher gets new singular i18n key `dashboard.checklist.item.firstClassSpawned.name` (UX honesty — was "First classes spawned" plural for single-class flow). `FirstAIGradeCard` band-ring `strokeDashoffset` computed from `overallBand` (was hardcoded 97 ≈ 63% — decoupled from fixture); criterion width clamped to [0,100]%; aria-label via i18n. `SampleDashboardPreview` dropped `role="status"` on threshold banner (was `aria-labelledby` target AND live region → SR re-announced section context every render). `YourClassesRow` date-only ISO parsed as LOCAL date not UTC-midnight (Americas timezone bug), Invalid Date guarded, `truncate` on cohortName heading, centerName defensive `?? ''`, stat-strip labels i18n-lifted (3 new placeholder keys). `TeacherDashboard` `snapshotContentEqual` now field-by-field on templateDraft (was JSON.stringify — key-order sensitive), added `currentCenter.name` compare (post-rename ghost stays fresh), dropped dead `currentStep` field from StableSnapshot. `TeacherDashboard.test.tsx` — `i18n.changeLanguage` awaited (locale race), `afterEach` locale reset, Cell 7 explicitly seeds MSW 500 error handler, Cell 5 uses `findByTestId` for race-safety, XOR mutex tests both directions. `dashboard-first-run.spec.ts` wrapped in `test.describe.skip()` with `TODO(FU-2-4-J)` comment. `dashboard.yourClasses.cardAriaLabel` gets "Class card: {{name}}" context prefix. **Deferred (16 items filed to `deferred-work.md`)**: FU-2-4-K NEW (per-user subscribers Map), `toBeCloseTo(-3)`, `getTimerCount` fuzzy, `as never` cast, rage-click breadcrumb throttle, dual-breadcrumb design, focus-management on snooze unmount, Storybook queryClient bleed, `WelcomeBackBanner replace:true` (shipped baseline), `role="status"` announcement storm (shipped baseline), `existsSync(DIST_DIR)` staleness, non-GET stub payload, `progressUnknownNoCenter` failureCount gate, latch clear-on-transient-non-done, `useEffect` on server state (documented pragmatic per feedback rule), `awaitingNextStep` branch label. **4 decisions resolved inline**: D1 `epicNum` mapping (2/3/4 semantic per owning epic); D2 Solo Teacher singular i18n key added; D3 stat-strip i18n-lifted; D4 e2e file `.skip()` gated. **Baseline commit `c639031` unchanged** — code review round 1 is an in-place edit. Status: **review → done**. |
| 2026-07-14 | **Party-mode adversarial review folded.** Sally + Winston + Amelia + Murat spawned as fresh-context general-purpose subagents (parallel); John ruled. **81 findings — 17 BLOCKERs + 43 STRONGs + 21 INFOs. 78 ACCEPTed inline; 2 DEFERRED (W-STRONG-9 → FU-2-4-H ESLint rule; W-INFO-18 info-only); 0 REJECTED.** ACs 15 → **17** (added AC1 loading/error matrix as embedded table, AC9 YourClassesRow, AC17 TeacherDashboard.test.tsx NEW-file discipline). Highest-leverage folds: **3-way convergence on Sonner adoption** (S-BLOCKER-2 + W-STRONG-8 + A-BLOCKER-2) — shipped `<Toaster />` at `App.tsx:74` + `toast.info(...)` from `sonner` replaces custom inline toast; FU-2-4-B discharged. **3-way convergence on i18n atomic commit** (W-BLOCKER-1 + A-BLOCKER-3 + M-STRONG-16) — 4-file rename: en/vi JSON + TeacherDashboard.tsx 3 sites + `i18n-parity-coverage.test.ts` (STORY_2_3A_KEYS lines 864-866 + ALLOWED_PREFIXES line 878 + JSDoc line 801 + STORY_2_3B_KEYS ALLOWED_PREFIXES_2_3B line 994). **2-way convergence on Solo enumeration** (S-STRONG-10 + A-STRONG-7) — resolved at story time via shipped `SoloFirstClassPage` grep confirming Solo always has `session.center`; Solo ships 4 items. **Fidelity correction**: mockup s09 ships 7 items not 6 (S-BLOCKER-1) — added `createMoreClasses` + `addResources`; dropped `setupBilling` from v1 (free-tier alignment). **NEW BLOCKER folds**: user.displayName not user.fullName (A-BLOCKER-1); AiMark grep-confirmed absent → inline resolution (A-BLOCKER-4); `stableProps` render-latch pattern to survive refetchOnWindowFocus race (W-BLOCKER-2); shared-lib `teachersInvitedCount.ts` extract + port 2-3c per pragmatic in-scope discipline (W-BLOCKER-3); resolvers read `ctx.currentCenter` not raw `ctx.session.center` (W-BLOCKER-4); pinned `STORY_2_4_KEYS` closed literal at story time (M-BLOCKER-1) — **42 keys** enumerated verbatim in AC14; test-count retarget ~+45 → **~+90** (M-BLOCKER-2); jsdom `StorageEvent` 5-field construction pattern pinned (M-BLOCKER-3); 12-cell MSW handler catalog table via shipped `progressWithPersona(...)` factory (M-BLOCKER-4); interpolation-parity over ALL 42 keys not filtered subset (M-BLOCKER-5). **Key STRONG folds**: `<YourClassesRow>` for all personas (S-BLOCKER-3 — mockup s09:7685-7728); DROP Dismiss from v1 (S-STRONG-13) — user has no in-app recovery until Story 2.5 ships Settings-Reopen surface (FU-2-4-D escalated P2); DROP "See how grading works" CTA on AI card (S-STRONG-7 dishonest dead-link); voice unification (S-STRONG-12) — AI card title "Grading looks like this." + disclaimer rewrite; per-persona body components (S-STRONG-11) — kill UX-3 violation now via `OperatorDashboardBody`/`FounderDashboardBody`/`SoloTeacherDashboardBody`; aria-live fraction announcement (S-STRONG-6); dismiss-confirm axe matrix expansion (M-STRONG-6 → moot since Dismiss dropped); Sonner queue-of-one via fixed toast id (W-STRONG-8); `userId` transition test (W-STRONG-5 + M-STRONG-12); `useCallback` module-scope stable subscribe (A-STRONG-12); StrictMode + test-isolation `beforeEach` reset (W-STRONG-6); progress.isError enumeration (W-STRONG-7); user.displayName Skeleton fallback (W-STRONG-12); 12-row expected-render mutex table (W-STRONG-14 + M-STRONG-15); `setTimeout` scheduled bump at snoozedUntil boundary (W-STRONG-15); Storybook DoD retarget (A-STRONG-10) — FinishSetupCard ≥8 (was ≥10), FirstAIGradeCard ≥6, YourClassesRow ≥4; `MALFORMED_LOCALSTORAGE_FIXTURES` 6-row enumeration (M-STRONG-11); grep-audit scope to `src/{features,locales}/**/*.{ts,tsx,json}` + closed-literal reject-list including Vietnamese `dùng thử` (A-STRONG-5 + M-STRONG-9 + M-STRONG-13); `data-testid` inventory pinned (M-STRONG-14); Playwright `page.clock.fastForward('7d1s')` (M-STRONG-10); `useSyncExternalStore` fake-timer rerender discipline pinned (M-STRONG-17); shared `src/lib/teachersInvitedCount.ts` refactor + port 2-3c OnboardingDonePage same commit (W-BLOCKER-3); `enrolStudents` reclassified Optional "Coming soon" badge (S-INFO-20 + A-STRONG-14 — permanent-red judgment feel eliminated); XSS-safety test for `cohortName` text-node (W-INFO-17); snooze Sentry breadcrumb (M-STRONG-8); filename-level regex + testid substring for chunk isolation (A-STRONG-11 — Rolldown minifies identifiers). **INFO folds**: LoginPage precedent divergence noted (A-INFO-16); targetSurface union extended to 8 values (A-INFO-17); green-phase task order recommended (A-INFO-18); Story 6.2 dependency explicitly discharged (A-INFO-19); sprint-status.yaml in DoD-8 (A-INFO-20); TEST-FE-2 N/A comment for fixture cards (M-INFO-20); Snoozed Storybook variant on TeacherDashboard.stories.tsx (W-INFO-20); rage-click test row (W-INFO-16); tabIndex dead-code removed (A-STRONG-6 + M-INFO-19). **FU list amended**: FU-2-4-B discharged (Sonner); FU-2-4-D escalated P3→P2; FU-2-4-G NEW (Dismiss return with 2.5); FU-2-4-H NEW (ESLint no-restricted-imports); FU-2-4-I NEW (perf smoke); FU-2-4-E merged S-INFO-15 (Founder-specific enumeration). **REJECTED: 0.** Story file 431 → **531** lines (under the 600-line convention ceiling with 11% headroom despite the 78-fold volume — party-mode fold delivered spec-density gains without bloat). Baseline commit `c639031` unchanged. Hand-off: optionally `/bmad-tea AT 2-4` (Task 0 — RECOMMENDED but SKIPPABLE), then `/bmad-dev-story 2-4`. |
