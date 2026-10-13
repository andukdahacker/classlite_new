# E2E tests — ClassLite cross-subdomain

Playwright E2E layer. Spans **landing** (`classlite.app`, Astro) and
**dashboard** (`my.classlite.app`, React/Vite) so login on the landing
page carries through to the dashboard via shared `.classlite.app` cookies.

## Install

From `classlite-web/`:

```bash
npm install --save-dev @playwright/test
npx playwright install chromium webkit firefox
```

## Preconditions (Story 11-2 — the authenticated lane)

The authenticated projects log in through the **real** `POST /api/auth/login`
and capture the real `refresh_token`. That requires, in the SAME shell:

1. **A running, SEEDED API on `:8080`.** Playwright's `webServer` starts only
   Vite — it does NOT start the API. Seed + run it first:
   ```bash
   # from the repo root — seed.sh reads DATABASE_URL from .env and runs cmd/seed,
   # emitting classlite-web/tests/e2e/.auth/credentials.json:
   ./scripts/seed.sh
   # then run the API on :8080 with the env below (CORS_ORIGINS must include the
   # cross-subdomain hosts — the server's OriginCheck rejects state-changing
   # POSTs, incl. login/refresh, whose Origin is not allow-listed):
   cd classlite-api && \
     COOKIE_DOMAIN=.classlite.localhost \
     APP_ENV=development \
     CORS_ORIGINS=http://my.classlite.localhost:5173,http://classlite.localhost:4321 \
     go run ./cmd/api
   ```
2. **`COOKIE_DOMAIN=.classlite.localhost`** on the API. Without it the captured
   cookie's domain is wrong and every project boots silently un-authenticated.
   `auth.setup.ts` asserts the captured cookie domain fail-fast.
3. **`APP_ENV=development`** on the API. Any other value makes the cookie
   `Secure`, which `http://…localhost` can't send → a green setup that booted
   logged-out. `auth.setup.ts` asserts the cookie is not `Secure`.
4. Export `COOKIE_DOMAIN=.classlite.localhost` in the Playwright shell too — the
   cross-subdomain cookie specs skip-with-reason when it is unset.
5. **`CORS_ORIGINS`** on the API must include the dashboard + cross-subdomain
   origins (`http://my.classlite.localhost:5173,http://classlite.localhost:4321`).
   The server's `OriginCheck` 403s any state-changing POST — including
   `/api/auth/login` and `/api/auth/refresh` — whose `Origin` is not allow-listed.
   The default (`http://localhost:5173`) does NOT cover the `*.classlite.localhost`
   hosts the E2E lane uses. The harness sends an explicit `Origin` on its login
   POSTs (an APIRequestContext is not a browser and sends none by default).

The seed-emitted `tests/e2e/.auth/credentials.json` (gitignored, DD3) is the raw
login manifest the harness reads.

## Run

```bash
# WF-8 unit gate (no API needed — vitest on the harness logic):
npx tsc -b && npx vitest run tests/e2e/lib

# Authenticated E2E lane (needs the seeded API + env above), --workers=1:
npm run e2e -- --project=setup --project=dashboard --workers=1
npm run e2e -- --project=cross-subdomain --workers=1
npm run e2e:ui            # debug UI mode
```

> **CI does not run Playwright today.** These specs are a local lane. The CI
> gate + quarantine for the Playwright grid is **Story 11-5a** (the Playwright
> rot's named root cause is closed there, not here). What CI does enforce for
> 11-2: the harness vitest tests (`npm test`) and `tsc -b` (via `npm run build`,
> which compiles `tests/e2e/**` through `tsconfig.e2e.json`).

## How auth works (no stub)

The SPA keeps the access token in the TanStack Query cache (in-memory), not in a
cookie. The bridge that makes a cookie-only storageState boot authenticated is
the **boot-refresh**: on cold mount the SPA POSTs `/api/auth/refresh` with the
`refresh_token` cookie and re-mints the access token. So a context carrying only
the real `refresh_token` cookie boots logged-in.

`auth.setup.ts`:

1. `guardNotProduction(config)` — refuses to run a real login against a
   production-shaped target (allowlist: `localhost`, `*.classlite.localhost`,
   `*.classlite.app-staging`).
2. For each **consumed** identity (tenant-A `teacher` + tenant-A `teacher2`
   only — not all seeded roles; logging in all 10 manifest entries would trip
   the burst-8/IP login limiter), performs a real login and persists one
   storageState **file per identity** (`.playwright/<tenant>-<identity>.json`),
   each merged with the non-auth `lang` cookie.
3. Asserts each captured cookie is `refresh_token` with domain
   `.classlite.localhost` and not `Secure` — fail-fast on the two env
   preconditions above.
4. A setup-time smoke proves the persisted state actually BOOTS a live session
   (AC7): a 200 boot-refresh on the dashboard host + the `refresh_token` visible
   on the cross-subdomain host — the guard against the exact three-month blind
   spot where a green setup silently booted un-authenticated.

### One file per consuming context — the rotation rule

`POST /api/auth/refresh` **rotates**: it deletes the presented token and issues
a successor. Presenting a deleted token while a sibling exists triggers **family
revocation**. So a persisted `refresh_token` is **single-use against the
rotating server**: the moment a second SPA-booting context loads the same frozen
file and boots, it revokes the family and kills both sessions.

Consequences, enforced in the specs:

- **No shared rotating default** (`.playwright/auth.json` is retired). Each
  identity has its own file.
- A spec that **navigates the SPA** (so it boot-refreshes and rotates) mints a
  **fresh** session per browser context via the harness
  (`loginAndCaptureSession(context.request, cred)`) rather than reusing a frozen
  file — see `dashboard/role-scope.spec.ts`.
- A spec that only **reads the cookie jar** (`cross-subdomain/cookie-sharing`)
  does not boot and does not rotate, so it may read a persisted state directly.
- Run the authenticated lane with **`--workers=1`** so these projects serialize.

The full parallel-worker-safe session pool + the CI gate are **Story 11-5a**.

## Local hostnames

`*.localhost` is loopback per RFC 6761 — no `/etc/hosts` edits required.

- Landing (Astro): `http://classlite.localhost:4321`
- Dashboard (Vite): `http://my.classlite.localhost:5173`

Override per environment:

```bash
BASE_URL_LANDING=https://staging.classlite.app \
BASE_URL_DASHBOARD=https://staging.my.classlite.app \
npm run e2e
```

## Project layout

| Project | Test path glob | Runs on |
|---|---|---|
| `setup` | `tests/e2e/*.setup.ts` | Pre-flight; real login → per-identity `.playwright/<tenant>-<identity>.json` |
| `landing` | `tests/e2e/landing/*.spec.ts` | Astro landing pages (no specs yet) |
| `dashboard` | `tests/e2e/dashboard/*.spec.ts` | React dashboard (role-scope mints its own session) |
| `cross-subdomain` | `tests/e2e/cross-subdomain/*.spec.ts` | Tests spanning both hostnames |
| `mobile-safari` | `tests/e2e/mobile/*.spec.ts` | iPhone 13 WebKit (no specs yet) |
| `mobile-chrome` | `tests/e2e/mobile/*.spec.ts` | Pixel 7 Chromium (no specs yet) |

The `tests/e2e/lib/*.test.ts` files are **vitest** harness unit tests (the
runner split — Playwright owns `*.spec.ts`, vitest owns `tests/e2e/**/*.test.ts`),
not Playwright specs.
