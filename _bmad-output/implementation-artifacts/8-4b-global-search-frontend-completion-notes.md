# Story 8-4b: Completion Notes

_Implementation record for [`8-4b-global-search-frontend.md`](./8-4b-global-search-frontend.md). Status: review._

## Dev Agent Record

### Debug Log

- **LSP false positives throughout.** The IDE's TypeScript server resolved a STALE `components` type (auth schemas only — no `SearchResults`/`AnalyticsHome`, and it flagged the `resultHref` switch as non-exhaustive). Confirmed stale via `grep` (`SearchResults:` at `client.ts:2437`) and `tsc -b` exit 0 on the whole project. Relied on `tsc -b` + vitest as the authoritative gates ([[reference_web_typecheck_gate_is_tsc_b]]); ignored the LSP `components`/exhaustiveness noise.
- **jsdom missing `Element.prototype.scrollIntoView`** — cmdk calls it in a layout effect to keep the active item in view; jsdom has no layout. Added a global no-op stub to `src/test/vitest-setup.ts` (same class as the existing `getAnimations`/`ResizeObserver` polyfills), benefiting all cmdk consumers.
- **testid regex collision** — the item-subtitle testid `search-item-subtitle` matched the item-row regex `/^search-item-/`, inflating the passthrough item count. Renamed the subtitle testid to `search-subtitle`.
- **`apiFetch` already forwards `signal`** — D13's "add the signal param if absent (one line)" was already satisfied: `signal` is part of `RequestInit`, spread through `...rest` → `performFetch` → `fetch({ ...init })`. No change needed; the useSearch test asserts the percent-escaped URL and the query wires `{ signal }`.
- **`CommandDialog` sr-only-title association works as-is (D9 footgun did NOT bite).** The shadcn `command.tsx` renders `DialogTitle` as a SIBLING of `DialogContent`, but Radix shares `titleId` via the root `Dialog` context, so `aria-labelledby` resolves. The AC16 red-first `getByRole('dialog', { name })` assertion PASSED against the shipped `command.tsx` — no hand-edit of the generated primitive required.
- **AC4 debounce test** — an initial fake-timer + `vi.waitFor` approach hung (~31s). Switched to real timers + `userEvent.setup({ delay: null })` so the whole burst lands in one tick and only the FINAL value clears the 300ms window → exactly one request, deterministically.

### Completion Notes

Shipped the Cmd+K/Ctrl+K command palette entirely over the frozen 8-4a `GET /api/search` contract (rendered verbatim; scope never re-derived — R-1):

- **Primitives** — `useDebouncedValue<T>` (generic, ref-cleared) + `isMacPlatform()` (capped: one platform read → one glyph, `userAgentData` preferred over deprecated `navigator.platform`, SSR-guarded).
- **Query slice** — `searchKeys` (TS-3), `useSearch` via plain `apiFetch` (no meta, TS-4) with `enabled` on the 3-RUNE code-point floor (D4/D14, pinned FE↔BE), `keepPreviousData`, Query `signal`, `staleTime` 12s / `gcTime` 60s.
- **Deep-links** — one audited `resultHref(item, role)` + `seeAllHref(category, role)`; `role` lives ONLY here (route choice), never the renderer.
- **R-1 renderer** — `SearchResultsList` takes `SearchResults` + callbacks, NO `role` prop (scope filter unexpressible); iterates the fixed `CATEGORY_ORDER`, omits empty categories, `shouldFilter={false}` preserves server `similarity DESC` order.
- **Palette** — `SearchPalette` state machine (idle / loading-skeleton / empty / error+retry / results), per-category "See all" doorway, result-count `aria-live`, `role="combobox"`/`aria-expanded`. Body gated on `open` so the query clears on every close (no last-query recall — privacy).
- **Trigger** — `useCommandPalette` (EMPTY-dep global keydown + functional toggle, FW-4 inoculation; imperative open/close promotion seam), wired into `AppLayout` (`onActivate` at the SearchPill site + palette mounted when `role !== null`); `SearchPill` renders the platform glyph via new `search.hint.*` keys.
- **i18n** — 16 `search.*` keys en+vi, `STORY_8_4B_KEYS` ratchet registered in the master parity coverage test.
- **Contract co-finalize** — stripped the PROVISIONAL doc marker from the 4 schemas + `search` operation; `codegen.sh` re-run; `git diff --exit-code` on `client.ts` proved comment-only (D8 machine gate passed).

**Deferred (named):** FU-8-4-MOBILE (mobile search entry, blocked on a MobileTopbar successor), FU-8-4-SEEALL-PREFILL (per-list `?q=`), FU-8-4-RECENTS, FU-8-4-SEEALL (dedicated `/search` page). FR-67 stays PARTIAL (5-of-6; Q&A → FU-8-4-QA).

**Deviations from spec:** none material. The `command.tsx` a11y association needed no fix (D9 verify passed as-is). The "See all" doorway links to bare list views (prefill deferred to FU-8-4-SEEALL-PREFILL per D12's pragmatic fallback).

### Implementation Plan (as executed)

1. Task 1 — `useDebouncedValue` + `isMacPlatform` (+ tests, red→green).
2. Task 2 — MSW fixtures, `searchKeys`, `useSearch` (+ AC5/5a/6 red-first).
3. Task 3 — `resultHref`/`seeAllHref` (+ AC9 table + negative rows).
4. Task 4 — `SearchResultsList` (AC11 passthrough red-first) + `SearchPalette` state machine (AC4/7/12/13/14).
5. Task 7 (i18n pulled forward) — `search.*` keys en+vi so Task 4 interpolation tests pass.
6. Task 5 — `useCommandPalette` + AppLayout wiring + SearchPill glyph (AC1/2/3 + empty-dep proof + focus-return).
7. Task 6 — a11y (AC16 dialog-name red-first, combobox, aria-live, axe, keyboard flow).
8. Task 7 — `STORY_8_4B_KEYS` ratchet module + master registration.
9. Task 8 — strip PROVISIONAL (doc-only) → codegen → `git diff --exit-code` gate → full gate suite.
10. Task 9 — deferred-work back-fill + epic-08 + PRD FR-67 + these notes.

## File List

### Added

- `classlite-web/src/hooks/useDebouncedValue.ts`
- `classlite-web/src/hooks/__tests__/useDebouncedValue.test.ts`
- `classlite-web/src/lib/platform.ts`
- `classlite-web/src/lib/__tests__/platform.test.ts`
- `classlite-web/src/features/search/api/searchKeys.ts`
- `classlite-web/src/features/search/api/useSearch.ts`
- `classlite-web/src/features/search/api/__tests__/handlers.ts`
- `classlite-web/src/features/search/api/__tests__/useSearch.test.tsx`
- `classlite-web/src/features/search/lib/resultHref.ts`
- `classlite-web/src/features/search/lib/__tests__/resultHref.test.ts`
- `classlite-web/src/features/search/components/SearchResultsList.tsx`
- `classlite-web/src/features/search/components/__tests__/SearchResultsList.test.tsx`
- `classlite-web/src/features/search/SearchPalette.tsx`
- `classlite-web/src/features/search/__tests__/SearchPalette.test.tsx`
- `classlite-web/src/features/search/__tests__/SearchPalette.a11y.test.tsx`
- `classlite-web/src/features/search/__tests__/searchPaletteIntegration.test.tsx`
- `classlite-web/src/features/search/hooks/useCommandPalette.ts`
- `classlite-web/src/features/search/hooks/__tests__/useCommandPalette.test.ts`
- `classlite-web/src/features/search/__tests__/searchI18nKeys.ts`
- `classlite-web/src/components/domain/__tests__/SearchPill.test.tsx`

### Modified

- `classlite-web/src/components/domain/SearchPill.tsx` — platform glyph via `search.hint.*` + wired `onActivate` docstring.
- `classlite-web/src/components/shared/AppLayout.tsx` — consume `useCommandPalette`, pass `onActivate`, mount `<SearchPalette>` when authenticated.
- `classlite-web/src/test/vitest-setup.ts` — `Element.prototype.scrollIntoView` no-op stub (cmdk).
- `classlite-web/src/locales/en.json` / `vi.json` — 16 new `search.*` keys.
- `classlite-web/src/lib/test/__tests__/i18n-parity-coverage.test.ts` — registered `STORY_8_4B_KEYS`.
- `classlite-web/src/lib/api/client.ts` — regenerated (comment-only diff; PROVISIONAL markers dropped).
- `classlite-api/api.yaml` — stripped PROVISIONAL phrasing from the `search` operation + 4 schemas (doc-only, shape unchanged).
- `_bmad-output/implementation-artifacts/deferred-work.md` — 4 new FU-8-4 follow-ups + FR-67 traceability.
- `_bmad-output/planning-artifacts/epics/epic-08.md` — 8-4b done note.
- `_bmad-output/planning-artifacts/prds/prd-classlite_new-2026-05-26/prd.md` — FR-67 status (palette done; PARTIAL only for Q&A).

### Deleted

- none
