# Storybook Conventions — Dashboard (`classlite-web/`)

> **Living doc.** Source of truth for Storybook authoring across Epic 1D
> and every downstream epic. Update when a convention changes; don't
> fork. See `storybook-rolldown-spike.md` for the Vite 8 / Rolldown
> compat outcome and `_bmad-output/implementation-artifacts/1d-1-storybook-foundation.md`
> for the AC contract.

## 1. Three-tier compatibility ladder (AC1)

Storybook 10.4 runs on the production Vite 8 / Rolldown stack — **Tier A
is the current posture**. Tier B (dual-builder fallback) and Tier C
(defer Storybook entirely) were not invoked. The full spike record lives
at `storybook-rolldown-spike.md`.

If a future Vite or Rolldown bump breaks Storybook:
1. Re-run the 5 Tier A acceptance checks in the spike doc.
2. If Tier A fails, configure `.storybook/main.ts`'s framework with
   `options.builder.viteConfigPath` pointing at a separate
   `.storybook/vite.config.storybook.ts` that omits Rolldown. The main
   `vite.config.ts` keeps Rolldown for the production bundle. This is
   the documented dual-builder fallback — maintainers MUST NOT unify
   the two configs.
3. Tier C (defer Storybook) requires explicit PM (John) + user (Ducdo)
   approval and opens follow-up story `1d-Z`.

## 2. Story file naming + placement (AC7)

Story files MUST live next to their component in one of three tiers
(per project-context `FW-7`):

| Tier | Path | Example |
|---|---|---|
| Primitive | `src/components/ui/` | `src/components/ui/Button.stories.tsx` |
| Domain | `src/components/domain/` | `src/components/domain/SidebarShell.stories.tsx` |
| Feature-local | `src/features/<area>/components/` | `src/features/grading/components/GradingCard.stories.tsx` |

The placement rule is enforced by `.storybook/test-runner.ts`'s setup
hook (calls `checkFw7Placement()` from `src/test/storybook-rules/`).
Error-on-merge from day 1.

**Naming:** `<Component>.stories.tsx` — component name in PascalCase,
file extension `.tsx`. The component is imported from a relative sibling
(`import { Button } from './Button'`), never via a barrel — the story
documents the component's exact module surface.

## 3. Required exports per component pattern (AC3)

The `@storybook/test-runner` setup hook scans every story file and
requires the three-state set for data-rendering components:

| File pattern | Required exports |
|---|---|
| `*Table.stories.tsx` | `Default`, `Loading`, `Empty`, `Error` |
| `*List.stories.tsx`  | `Default`, `Loading`, `Empty`, `Error` |
| `*Card.stories.tsx`  | `Default`, `Loading`, `Empty`, `Error` |
| `*Hero.stories.tsx`  | `Default`, `Loading`, `Empty`, `Error` |
| `*Shell.stories.tsx` | `Default`, `Loading`, `Empty`, `Error` |

Primitives under `src/components/ui/` are exempt. They export `Default`
plus the variant exports relevant to their own API (per Story 1d-2's
shadcn-primitive coverage).

**Role variants (UX-DR29).** Components that branch on `useRole()`
additionally export `OwnerView`, `AdminView`, `TeacherView`,
`StudentView`. The role-variant requirement is enforced by code review
(no automated pattern can detect role-branching from a filename alone) —
flag it during PR review whenever a component imports `useRole`.

**Proof of teeth.** The rule has a canonical negative fixture at
`src/test/fixtures/lint-bait/MissingEmptyTable.stories.tsx`. A Vitest
test (`src/test/storybook-rules/required-exports.test.ts`) reads it,
parses the exports, and asserts `checkRequiredExports()` returns
`ok: false` with `missing: ['Empty', 'Error']`. If a future dev
"fixes" the fixture by adding the missing exports, the Vitest test
fails loudly — that is the entire point.

## 4. Decorator stack + preview-side dependencies (AC2)

`.storybook/preview.tsx` composes one outer decorator (`ChromeDecorator`)
that wraps every story in this order (outside → in):

1. `MemoryRouter` (React Router v7) — default `initialEntries={['/']}`,
   per-story override via `parameters.router.initialEntries`.
2. `QueryClientProvider` — fresh `QueryClient` per render, `retry: false`,
   `staleTime: 30_000` (matches FW-3 app default).
3. `I18nextProvider` — full `en.json` + `vi.json` loaded synchronously;
   the **Locale** toolbar switches `i18n.changeLanguage()` AND
   `setDefaultOptions({ locale })` on `date-fns` (TS-6 — calendar / date
   formatters honor the toolbar).
4. `RoleProvider` — wraps the existing `RoleContext` (Story 1d-1) so
   `useRole()` returns the toolbar-selected role. The **Role** toolbar
   exposes `owner`, `admin`, `teacher`, `student`.
5. `Suspense` — single top-level boundary with a skeleton fallback so any
   story that uses `useSuspenseQuery` (FW-1) renders without crashing the
   preview.

Preview-side dependencies imported before any decorator runs:

- `src/index.css` — Tailwind + tokens + dark-mode tokens + Fraunces /
  Geist / Geist Mono font packages (via fontsource CSS imports).
- `msw-storybook-addon` — `initialize({ onUnhandledRequest: 'bypass' })`;
  per-story handlers in `parameters.msw.handlers`.

**Composition order matters.** Document any new decorator at the top of
`preview.tsx` and preserve the chain.

## 5. Locale and role switching

Both globals appear in the Storybook toolbar:

- **Locale:** `en`, `vi`. Setting `vi` flips i18n + date-fns; assert the
  story renders correctly with Vietnamese strings (Geist body font, no
  fallback flash).
- **Role:** `owner`, `admin`, `teacher`, `student`. Setting any value
  causes `useRole()` inside the story to return that role.

Every component test should resolve labels via `i18n.t(...)` (per
TEST-FE-4) and never hardcode English. The bilingual smoke spec in
`tests/bilingual-smoke.spec.ts` walks the production app's auth + error
surfaces in both locales — Storybook coverage is the per-component
analogue.

## 6. MSW handler patterns (TEST-FE-1 inheritance)

Stories declare handlers via `parameters.msw.handlers`:

```ts
import { http, HttpResponse } from 'msw'

export const Default = {
  parameters: {
    msw: {
      handlers: [
        http.get('/api/v1/classes', () => HttpResponse.json({ data: mockClasses })),
      ],
    },
  },
}
```

**`Empty` stories MUST be driven by MSW returning empty data.** Never
mock `useQuery` / `useMutation` — that breaks the TEST-FE-1 contract
shared with component tests:

```ts
// CORRECT — MSW returns empty data; the consumer renders its empty branch.
export const Empty = {
  parameters: {
    msw: {
      handlers: [http.get('/api/v1/classes', () => HttpResponse.json({ data: [] }))],
    },
  },
}

// INCORRECT — never
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: [] }) }))
```

`Error` stories use `HttpResponse.error()` or `new HttpResponse(null, { status: 500 })`. The component renders its error branch — either the inline `ErrorStatePlaceholder` (Epic 1D) or the real `ErrorState` (Epic 10).

Fixture data lives at `src/test/fixtures/` so it stays out of feature
bundles. The two pre-Epic-10 placeholders live there:
`empty-state-placeholder.tsx` and `error-state-placeholder.tsx`. When
Epic 10 Stories 10.3 / 10.4 ship the real `EmptyState` / `ErrorState`,
a single find-replace migrates the imports.

## 7. Three-state authoring template (with placeholder pattern)

Copy this template for any new data-rendering domain component story:

```ts
import type { Meta, StoryObj } from '@storybook/react-vite'
import { http, HttpResponse } from 'msw'
import { EmptyStatePlaceholder } from '@/test/fixtures/empty-state-placeholder'
import { ErrorStatePlaceholder } from '@/test/fixtures/error-state-placeholder'
import { MyComponent } from './MyComponent'

const meta = {
  title: 'domain/MyComponent',
  component: MyComponent,
} satisfies Meta<typeof MyComponent>

export default meta
type Story = StoryObj<typeof meta>

const handlersWith = (data: unknown) => [
  http.get('/api/v1/things', () => HttpResponse.json({ data })),
]

export const Default: Story = {
  parameters: { msw: { handlers: handlersWith(mockThings) } },
}

export const Loading: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/things', () => new Promise(() => {}))] },
  },
}

export const Empty: Story = {
  parameters: { msw: { handlers: handlersWith([]) } },
  render: () => <EmptyStatePlaceholder /* TODO Epic 10: swap to EmptyState */ />,
}

export const Error: Story = {
  parameters: {
    msw: { handlers: [http.get('/api/v1/things', () => HttpResponse.error())] },
  },
  render: () => <ErrorStatePlaceholder /* TODO Epic 10: swap to ErrorState */ />,
}
```

**Pre-Epic-10 → Epic 10 migration.** When Epic 10 Story 10.3 lands
`<EmptyState>` and Story 10.4 lands `<ErrorState>`, run a find-replace
across the repo: `EmptyStatePlaceholder` → `EmptyState`,
`ErrorStatePlaceholder` → `ErrorState`. Then delete
`src/test/fixtures/empty-state-placeholder.tsx` +
`src/test/fixtures/error-state-placeholder.tsx`. The story shape stays
unchanged — only the imports move.

## 8. i18n parity — INHERITED from Story 1-7c (AC4 + R38)

R38 (Vietnamese key parity, register score 6) is discharged at the
foundation level by Story 1-7c. No new helper, no new CI step, no new
failing-fixture infrastructure is required for 1d-1 or downstream Epic
1D stories.

Existing artifacts (do **not** duplicate; use as-is):

| Artifact | Path |
|---|---|
| `assertI18nParity(usedKeys, locales)` Vitest helper | `src/lib/test/i18n-parity.ts` |
| Helper unit tests | `src/lib/test/i18n-parity.test.ts` |
| ATDD red specimen + per-story coverage block file | `src/lib/test/__tests__/i18n-parity-coverage.test.ts` |
| Whole-file CLI parity script | `scripts/i18n-parity.mjs` |
| CI step (required check) | `.github/workflows/ci-web.yml` — runs `npm run i18n-parity` |

**Per-story pickup (1d-2 / 1d-3 / 1d-4 and beyond).** When a story
introduces new i18n keys:

1. Add the keys to `src/locales/en.json` AND `src/locales/vi.json` in
   the **same** PR. Vietnamese is co-primary (UX-2, NFR-1) — never ship
   `en` first and `vi` later.
2. Extend `src/lib/test/__tests__/i18n-parity-coverage.test.ts` with a
   new `describe('Story 1d-N i18n parity (R38)', ...)` block that
   enumerates the story's keys and calls `assertI18nParity(STORY_KEYS)`.
3. In any component test that calls `t(...)`, also call
   `assertI18nParity([...usedKeys])` so the test fails red against
   missing keys before any UI assertion fires.
4. `npm run i18n-parity` MUST pass green locally before opening the PR;
   the CI step blocks merge on key divergence or empty values.

**Why a separate per-story `describe` block?** It tracks accountability:
when a key is later questioned, `git blame` lands on the introducing
story rather than a flat top-of-file list that everyone edits.

## 9. `axe-core` baseline (AC5)

`@storybook/addon-a11y` is wired in `.storybook/main.ts` with
`parameters.a11y.test = 'error'` set in `preview.tsx`. That posture:

- **Storybook UI:** the a11y panel on the sidebar runs axe-core on the
  active story and surfaces violations inline as authoring feedback.
- **CI test-runner:** every story rendered by `storybook:test` runs the
  axe audit; any violation fails the build.

**When violations appear.** Author triage order:

1. Real component bug → fix the component (preferred).
2. Test environment artifact (e.g. missing `<html lang>` in the
   iframe) → patch the harness, not the test parameters.
3. Genuine token / design exception → add to `axe.allowlist.json` with
   a written justification + ticket reference. The allowlist is
   reviewed at each epic boundary; do not grow it casually. The Story
   1-7c `axe.allowlist.json` governance carries forward.

**If Tier C is ever invoked** (no Storybook), this gate disappears for
Epic 1D and TEA must re-scope the epic's a11y plan. See AC5 / spike
doc.

## 10. Designer access

The Storybook job in `ci-web.yml` uploads `storybook-static/` as a
14-day GitHub Actions artifact. Designers download it via the Actions
run's artifact section and open `index.html` locally.

Preview deployment to Cloudflare Pages is a follow-up improvement story
(out of scope for 1d-1) — when it ships, this section gains a direct
URL pattern. Until then, the artifact download is the canonical designer
handoff.

## Branch-protection requirement

The new `storybook` job is a sibling of `test` in `ci-web.yml` — there is
no `needs:` linkage, so the two run in parallel. **Branch protection on
`main` MUST require BOTH `test` AND `storybook` status checks.** If only
`test` is required, a PR that breaks the storybook gate (axe violation,
three-state miss, placement error) will still be marked mergeable in the
GitHub UI.

This is a one-time repo-admin task — flag it on the PR description for
1d-1 so the admin can update branch protection before merging.

## CI runtime budget (AC6)

The `storybook` job has a soft cap of **8 minutes on PR** (per Winston's
CI-delta finding). Track runtime in the Actions log; once the trend
exceeds the cap after the component inventory grows past ~100 stories,
shard via `test-storybook --shard 1/3 2/3 3/3` in parallel matrix
strategy. Update this section with the actual sharding pattern when it
lands.

Currently observed runtime: well under 8 minutes (Storybook smoke story
+ rule scan + a11y on a single primitive). Re-measure at each epic
boundary.
