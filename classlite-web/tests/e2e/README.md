# E2E tests — ClassLite cross-subdomain

Playwright E2E layer. Spans **landing** (`classlite.app`, Astro) and
**dashboard** (`my.classlite.app`, React/Vite) so login on the landing
page carries through to the dashboard via shared `.classlite.app` cookies.

## Install

Playwright is not yet installed. From `classlite-web/`:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium webkit firefox
```

## Run

```bash
npm run e2e               # all projects
npm run e2e -- --project=cross-subdomain
npm run e2e -- --project=mobile-safari
npm run e2e:ui            # debug UI mode
```

## Local hostnames

To make `.classlite.localhost` cookies work, both dev servers must run on
subdomain hostnames. The browser treats `*.localhost` as loopback per
RFC 6761, so no `/etc/hosts` edits are required.

- Landing (Astro): `http://classlite.localhost:4321`
- Dashboard (Vite): `http://my.classlite.localhost:5173`

Override per environment via env vars:

```bash
BASE_URL_LANDING=https://staging.classlite.app \
BASE_URL_DASHBOARD=https://staging.my.classlite.app \
npm run e2e
```

## Project layout

| Project | Test path glob | Runs on |
|---|---|---|
| `setup` | `tests/e2e/*.setup.ts` | Pre-flight; writes `.playwright/auth.json` |
| `landing` | `tests/e2e/landing/*.spec.ts` | Astro landing pages |
| `dashboard` | `tests/e2e/dashboard/*.spec.ts` | React dashboard |
| `cross-subdomain` | `tests/e2e/cross-subdomain/*.spec.ts` | Tests spanning both hostnames |
| `mobile-safari` | `tests/e2e/mobile/*.spec.ts` | iPhone 13 WebKit |
| `mobile-chrome` | `tests/e2e/mobile/*.spec.ts` | Pixel 7 Chromium |

All non-setup projects inherit `storageState` from `setup`, so login runs
exactly once per Playwright invocation.

## Story 1.5 follow-up

`auth.setup.ts` currently writes a stub session cookie because the login
API doesn't exist yet (Story 1.5). When 1.5 ships:

1. Replace the `addCookies` block with a real `request.post('/api/auth/login', ...)` call
2. Let Playwright capture the `Set-Cookie` header
3. Keep `context.storageState({ path: STORAGE_STATE })` so the rest works unchanged
