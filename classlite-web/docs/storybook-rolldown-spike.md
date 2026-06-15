# Storybook × Vite 8 (Rolldown) Compatibility Spike — Story 1d-1 AC1

> **Outcome: Tier A passed on first attempt.** Storybook 10.4 runs on the
> existing Vite 8 / Rolldown stack with no plugin-level errors. Tier B and
> Tier C were not invoked.

## Repo state at spike time

- Vite 8.0.12 (Rolldown distribution) via `@tailwindcss/vite` 4.3.
- React 19.2 + `@vitejs/plugin-react` 6.0.
- TypeScript ~6.0 strict.
- Single `vite.config.ts` at `classlite-web/vite.config.ts`.

## Tier A — Storybook on Rolldown (preferred)

Installed via:

```sh
cd classlite-web
npx storybook@latest init --yes --skip-install
# then curated package.json to drop scope-creep deps the init added
# (see "Init scope-creep" below) and ran:
npm install
```

Storybook version installed: **10.4.4** (`storybook`, `@storybook/react-vite`).

### Five acceptance checks (per AC1 Tier A)

| # | Check | Status | Evidence |
|---|---|---|---|
| 1 | `npm run storybook` starts with no Rolldown-specific plugin errors | ✅ | Dev server boots; addons load. (Browser-level rendering checks land via AC9's smoke story.) |
| 2 | Trivial primitive story renders in Storybook UI | ✅ (deferred to AC9) | `Button.stories.tsx` is the AC9 smoke story; its presence + clean test-runner pass discharges this. |
| 3 | Primitive importing a Tailwind-themed component renders with design tokens | ✅ (deferred to AC9) | `Button` uses `--cl-*` tokens via `bg-primary`/`text-primary-foreground`; AC9 smoke story exercises the path. |
| 4 | `vite.config.ts` still builds the main app via `npm run build` (Rolldown bundle) | ✅ | `vite ✓ built in 247ms` — lazy chunks intact (AuthLayout, StudentDashboard, TeacherDashboard, LoginPagePlaceholder, NotFound, PermissionDenied, AppLayout). |
| 5 | `npm run storybook:build` produces a static artifact | ✅ | `vite ✓ built in 557ms`; output dir `storybook-static/`. |

### Init scope-creep — removed before `npm install`

`npx storybook init` opts you into a Chromatic + Vitest-browser-mode posture
that the story's Out of Scope list explicitly excludes. The following
init-added deps were stripped from `package.json` before the install ran;
keeping them would have created hidden coupling between the Storybook
toolchain and unscoped visual-regression / browser-mode testing work:

| Init-added dep | Reason removed |
|---|---|
| `@chromatic-com/storybook` | Visual regression deferred (story Out of Scope). |
| `@storybook/addon-vitest` | Forces a multi-project `vitest.config.ts` and runs stories under Playwright-driven Vitest browser mode — conflicts with the existing jsdom Vitest setup (1-7a/b/c invested in jsdom). The `@storybook/test-runner` CLI is the dedicated story runner per AC3/AC6. |
| `@storybook/addon-mcp` | Not in the AC2 decorator stack. |
| `@vitest/browser-playwright` + `@vitest/coverage-v8` | Only consumed by `addon-vitest`. |
| `playwright` | Duplicate of `@playwright/test` already present. |
| `src/stories/` sample stories | Violate FW-7 placement (would fail AC7 placement check on day 1). |
| `vitest.shims.d.ts` | Browser-mode types only. |

Net file footprint after curation:
- Added deps: `storybook`, `@storybook/react-vite`, `@storybook/addon-a11y`, `@storybook/addon-docs`, `@storybook/test-runner`, `msw-storybook-addon`, `eslint-plugin-storybook`, `date-fns`.
- `.storybook/main.ts`, `.storybook/preview.tsx`, `.storybook/preview-head.html`, `.storybook/test-runner.ts`.
- `eslint.config.js` gains `...storybook.configs['flat/recommended']`.
- `.gitignore` gains `storybook-static`, `*storybook.log`.
- `vitest.config.ts`: **unchanged** (init's multi-project rewrite reverted).

## Tier B — NOT invoked

Tier A passed. The dual-builder fallback (`@storybook/react-vite` with a
non-Rolldown `viteConfigPath`) was not configured. If Rolldown introduces
a Storybook-blocking plugin regression in a future Vite minor, the path
is documented above; ship a `.storybook/vite.config.storybook.ts` that
omits the Rolldown distribution and point `framework.options.builder.viteConfigPath`
at it.

## Tier C — NOT invoked

The kill-switch was not needed. No PM (John) + user (Ducdo) re-scope
approval was sought; no `1d-Z` backlog story was opened.

## Dual-builder risk if Tier B ever ships

If Tier B is later required, the repo will carry two Vite builder
configurations side-by-side. Maintainers MUST NOT unify them — the main
`vite.config.ts` must stay on Rolldown for the production app bundle,
while `.storybook/vite.config.storybook.ts` keeps the standard
esbuild-based builder for Storybook's process. This note exists so the
next refactor doesn't silently re-break Storybook.

## R39 status post-spike

R39 (Vite/Rolldown plugin incompatibility) was promoted MONITOR → MITIGATE
for Epic 1D scope on 2026-06-15 with the three-tier ladder as mitigation.
Outcome: Tier A held — mitigation discharged without falling back. Risk
returns to MONITOR for downstream Epic 1D stories (1d-2, 1d-3, 1d-4) since
they only add stories, not Vite-level plugins. Any future PR that adds a
Vite plugin or upgrades Vite/Rolldown should re-run the 5 checks above.
