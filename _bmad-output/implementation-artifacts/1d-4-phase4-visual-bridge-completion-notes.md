# Story 1d-4: Completion Notes

_Implementation record for [`1d-4-phase4-visual-bridge.md`](./1d-4-phase4-visual-bridge.md). Status: review._

_First sibling-file written under the convention introduced 2026-06-22 in [`docs/bmad-story-conventions.md`](../../docs/bmad-story-conventions.md). The story file holds the spec (AC, tasks, Dev Notes, DoD, Change Log capped at 5); this file holds the implementation record (Dev Agent Record, File List, future review appendices)._

## Dev Agent Record

### Debug Log

- **Tier-2 contrast on `text-muted-foreground`:** axe-core flagged `--cl-muted` (#595c66) on `bg-card` (#ffffff) at `text-xs` size, despite the 6.7 ratio passing AA on paper. Rather than relax the test bar or carry a per-component allowlist, the criterion / meta / footer labels switched to `text-foreground` and bumped to `font-semibold` where they were already `font-medium`. Honest fix: small-caps labels were borderline anyway; AA-with-margin reads better in the editorial-paper aesthetic.
- **Resolved-card opacity:** `CommentCard` initially applied `opacity-60` to the whole card when `resolved={true}`, which dropped effective `text-foreground` contrast below 4.5 (computed foreground became #767982). Replaced with `bg-muted/40` background tint + body-only `line-through`; full token contrast survives and the "resolved" affordance reads cleaner.
- **`<header>` inside region landmark:** `MobileWritingSurface` wrapped its app-bar in `<header>` while the outer container had `role="region"`. axe `landmark-banner-is-top-level` fired because `<header>` provides an implicit banner landmark that cannot be nested inside another landmark. Swapped to plain `<div data-testid="...">` — visual identity unchanged, landmark contract restored.
- **Heading-order with `EmptyStatePlaceholder` children:** `AnalyticsHomeShell` Empty / Error stories originally rendered the full shell with two `EmptyStatePlaceholder` children (each `<h3>`), but the shell's own `PageHead` is `<h1>` — `h1 → h3` skips `h2`. The `Default` / `TeacherView` / etc. stories adjusted their local `AnalyticsCardSkeleton` helper from `<h3>` to `<h2>`. The Empty / Error stories switched to a custom `render` that drops the shell entirely (matches the pattern in `PageHead.stories.tsx`'s Empty / Error).
- **`stripCommentsAndStrings` apostrophe-in-template + apostrophe-in-double-quoted-string bug:** the shared util ran `SINGLE_QUOTE` before `TEMPLATE` and `DOUBLE_QUOTE`, so `` `I'm trying...` `` (template) and `message="couldn't load..."` (JSX double-quoted attribute) both false-opened a single-quoted string and ate every export declaration after them. This is the third occurrence of the same regex-strip class of bug (after the two JSDoc-apostrophe ones the util was originally fixed for, 1d-3 follow-up #16). Reordered the passes to `BLOCK → LINE → TEMPLATE → DOUBLE_QUOTE → SINGLE_QUOTE` and added two regression tests in `src/test/__tests__/strip-comments-and-strings.test.ts`. The acorn-tokenizer migration this util's docstring promises now has its tripwire fired — tracked as a separate follow-up, but the targeted reorder ships with this story so 1d-4 is unblocked.
- **Stale `SidebarNavItem.LongVietnameseLabel` play test:** 1d-3 code review pass (`9da21b7`) dropped the native `title` attribute from `SidebarNavItem` per P23 ("Tooltip owns hover/focus reveal") but did not update the play test which still asserted `toHaveAttribute('title', fullLabel)`. The Storybook test-runner was not re-run during the 1d-3 code-review close-out, so the regression sat dormant until 1d-4's full sweep. Test updated in lockstep: `not.toHaveAttribute('title')`.

### Completion Notes

- All 8 ACs discharged, all 8 tasks checked, all 10 DoD items satisfied except the designer-notification non-code follow-up.
- 10 components shipped (one more than the AC count because `CommentCard` is a shared sub-component between AC2 + AC3 — it was already partially staged at story pickup).
- 8 net-new `.stories.tsx` files; every file exports `Default + Loading + Empty + Error` to satisfy 1d-1's three-state lint rule, plus the spec-listed variants (Saving / Offline / LocaleEn / LocaleVi / role-views / etc.). Loading stories render skeleton placeholders matching the component shape; Empty / Error reuse 1d-1's `EmptyStatePlaceholder` / `ErrorStatePlaceholder` until Epic 10 lands the canonical `EmptyState` / `ErrorState`.
- `CommentCard` is shared between `WritingGradingSurface` (AC2) and `SpeakingGradingSurface` (AC3); its timestamp slot is optional so the speaking variant can pass the `M:SS` Geist Mono pin timestamp.
- `InboxListShell` ships three Storybook stories per UX-3 (`TeacherView` / `StudentView` / `AdminOwnerView`), with `role` as data and the row taxonomy differing at the fixture layer. Same pattern for `AnalyticsHomeShell` per UX-DR29.
- `AnchoredQuestionCard` ships ONE component with a `variant` prop (`teacher-answer` / `student-ask`) per the Dev Notes rationale — it's a layout-level switch like Tabs, not a role-conditional branch.
- `MobileWritingSurface` is locked to the `iphone14` viewport via `parameters.viewport.defaultViewport`. Body uses inline `style={{ fontSize: '16px' }}` to lock the UX-4 mobile minimum even when Tailwind's `text-base` resolves smaller in some contexts. Line-height `1.7` gives Vietnamese IME room.
- `SpeakingGradingSurface` ships a deterministic sine-modulated waveform path built at module scope (no `Math.random`, no `new Date()`). The play button + pins are static chrome — Epic 6 Story 6.3 owns the audio decode.
- `ScopeBar` renders the date-range picker as a single button label rather than mounting the Calendar primitive in the trigger surface — the Calendar `Range` story integration is documented as a consumer concern for Epic 8 because mounting it here would have required a `Date` object in render, violating TS-6 + AC8's no-`new Date()` audit.
- New CSS classes `cl-anchor-error` / `cl-anchor-praise` / `cl-anchor-suggest` added to `src/index.css` for the anchored span highlights in AC2's `essayHtml`. Tints reuse existing `--cl-tint-*` tokens so the editorial palette stays cohesive; the underline reinforcement covers color-blind users (WCAG 1.4.1).
- 122 net-new i18n keys (61 each en + vi) added; all 122 enumerated in the new `STORY_1D_4_KEYS` block in `i18n-parity-coverage.test.ts`. None of the new namespaces (`writeDocSurface.*`, `writingGrading.*`, `speakingGrading.*`, `anchoredQuestion.*`, `mobileWriting.*`, `inboxRow.*`, `inboxList.*`, `scopeBar.*`, `analyticsHome.*`, `commentCard.*`, `criterion.*`) appear in `COVERED_NAMESPACES`, so the parity script's namespace-coverage gate is satisfied transitively (the per-story discharge block is purely for traceability + future audits).
- Two carry-over fixes that ship with 1d-4 but aren't 1d-4 features:
    1. `scripts/lib/strip-comments-and-strings.mjs` pass-order fix + 2 regression tests (see Debug Log above).
    2. `SidebarNavItem.LongVietnameseLabel` play test no-longer-asserts the removed `title` attribute (1d-3 code-review follow-up that wasn't caught by the 1d-3 storybook sweep).

### Implementation Plan (as executed)

1. **Scaffold survey.** Read project-context, conventions doc, sprint-status, existing 1d-3 components (PageHead, AppShell, decorators), 1d-2 primitives, EmptyState / ErrorState placeholders, three-state lint rule, i18n-parity script + test.
2. **CommentCard reconciliation.** `CommentCard.tsx` was already untracked at story pickup with most of the visual identity in place; reused it as the shared sub-component for AC2 + AC3 after auditing it against the spec.
3. **AC1 → AC7 sequential build.** Each AC: component file → story file (Default + Loading + Empty + Error + spec variants + LocaleEn/Vi). Followed the Dev Notes static-shells discipline literally — no `useState` for data, no `useEffect`, no `useMutation` anywhere in any 1d-4 file.
4. **i18n consolidation.** Added 122 keys to en.json + vi.json in lockstep; extended `STORY_1D_4_KEYS` block in the parity test.
5. **First gate sweep.** Ran tsc, lint, lint:css, vitest, i18n-parity, build, storybook:build — all clean.
6. **Storybook test-runner sweep.** First run flagged: (a) extractor failed on apostrophe-in-template (`stripCommentsAndStrings` bug), (b) extractor failed on apostrophe-in-double-quoted-string (same util), (c) axe violations — banner landmark, opacity-60 contrast, muted-foreground contrast, heading-order. Each addressed with the targeted fix above.
7. **Pre-existing fix.** `SidebarNavItem.LongVietnameseLabel` play test brought in line with the 1d-3 code-review's title-attribute drop.
8. **Final regression sweep.** All gates clean: storybook 283/283 axe-clean (55 suites), vitest 251/251, i18n-parity 233 keys, tsc + lint + lint:css + build all clean.

## File List

### Added

- `classlite-web/src/components/domain/WriteDocSurface.tsx` — AC1 component.
- `classlite-web/src/components/domain/WriteDocSurface.stories.tsx` — AC1 story matrix (8 exports).
- `classlite-web/src/components/domain/WritingGradingSurface.tsx` — AC2 component.
- `classlite-web/src/components/domain/WritingGradingSurface.stories.tsx` — AC2 story matrix (9 exports).
- `classlite-web/src/components/domain/SpeakingGradingSurface.tsx` — AC3 component.
- `classlite-web/src/components/domain/SpeakingGradingSurface.stories.tsx` — AC3 story matrix (7 exports).
- `classlite-web/src/components/domain/AnchoredQuestionCard.tsx` — AC4 component.
- `classlite-web/src/components/domain/AnchoredQuestionCard.stories.tsx` — AC4 story matrix (10 exports).
- `classlite-web/src/components/domain/MobileWritingSurface.tsx` — AC5 component.
- `classlite-web/src/components/domain/MobileWritingSurface.stories.tsx` — AC5 story matrix (6 exports, iphone14 viewport).
- `classlite-web/src/components/domain/InboxRow.tsx` — AC6 row sub-component.
- `classlite-web/src/components/domain/InboxListShell.tsx` — AC6 container.
- `classlite-web/src/components/domain/InboxListShell.stories.tsx` — AC6 story matrix (10 exports — TeacherView, StudentView, AdminOwnerView per UX-3).
- `classlite-web/src/components/domain/ScopeBar.tsx` — AC7 scope strip.
- `classlite-web/src/components/domain/AnalyticsHomeShell.tsx` — AC7 container (composes PageHead + ScopeBar + grid).
- `classlite-web/src/components/domain/AnalyticsHomeShell.stories.tsx` — AC7 story matrix (11 exports).
- `classlite-web/src/components/domain/CommentCard.tsx` — shared sub-component for AC2 + AC3 (was untracked at pickup; finalized + ships with 1d-4).

### Modified

- `classlite-web/src/index.css` — added `.cl-anchor-error` / `.cl-anchor-praise` / `.cl-anchor-suggest` highlight classes for AC2 anchored-span fixture HTML.
- `classlite-web/src/locales/en.json` — 61 new keys across 11 new namespaces.
- `classlite-web/src/locales/vi.json` — 61 new keys mirroring en.json.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — added `STORY_1D_4_KEYS` block (122 keys) + describe.
- `classlite-web/scripts/lib/strip-comments-and-strings.mjs` — pass-order reorder so apostrophes inside backtick templates and double-quoted strings can't false-open single-quoted strings (third occurrence of this class of bug; tokenizer migration tracked separately).
- `classlite-web/src/test/__tests__/strip-comments-and-strings.test.ts` — two regression tests covering the reorder.
- `classlite-web/src/components/domain/SidebarNavItem.stories.tsx` — `LongVietnameseLabel` play test updated to match 1d-3 code-review's drop of the native `title` attribute (1d-3 carry-over fix that ships with 1d-4 to unblock the gate).
- `_bmad-output/implementation-artifacts/1d-4-phase4-visual-bridge.md` — Tasks all checked, DoD checked (except non-code designer-notify), Status review, Change Log appended pointing at this file.
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — `1d-4-phase4-visual-bridge: in-progress → review` + `last_updated` history.

### Deleted

_None._
