# Story 11.2: Real-Auth E2E Harness

Status: done

<!-- Validation optional. Run validate-create-story before dev-story if desired. -->

---
baseline_commit: 670ea1b
epic: 11
story: 11-2
size: S
wf8_gate: true   # R-11-3 scored 6 (SEC). Red-phase ATDD MANDATORY before in-progress.
depends_on: [11-1a]
---

## Story

As a **developer**,
I want **Playwright to authenticate as a real seeded user through the real login endpoint, with every authenticated project proven to actually boot a live session**,
so that **the dashboard, cross-subdomain and mobile projects test a genuine session instead of a placeholder cookie — and no session-minting shortcut can ship in a production build**.

This story **retires `classlite-web/tests/e2e/auth.setup.ts`'s `classlite_session=stub-session-token-for-phase-0`** and its three-month-old Story-1.5 TODO. It is named **by path** because that TODO survived precisely because no story ever named the file. When this story is done, no fabricated session value remains anywhere under `tests/`, every Playwright project that needs auth boots through a **real** `POST /api/auth/login` session **that is positively asserted to work** (not merely minted at setup), and the E2E red-phase convention is written into `docs/bmad-story-conventions.md`.

> **This story exists because a fake session went unnoticed for three months.** The failure mode to defend against is not "no real login" — it is "a green setup that silently booted *un*authenticated." Every AC below is written so a half-working session fails LOUD, not green.

## Acceptance Criteria (BDD)

### AC1 — Real login, real cookie, zero stub — with a provenance oracle (not just grep)
- **Given** the credentials manifest `classlite-web/tests/e2e/.auth/credentials.json` emitted by 11-1a (array of `{role, email, password, centerShortCode, centerId}`),
- **When** `auth.setup.ts` runs,
- **Then** it `POST`s `/api/auth/login` with a seeded `{email, password, rememberMe}` body and captures the **real `refresh_token`** `Set-Cookie` into a persisted storageState via `request.storageState()` — **after asserting the login returned `200` and the jar actually gained a `refresh_token`** (a non-2xx or empty jar throws loudly in setup; never persist a cookieless state).
- **And** no fabricated session value remains under `classlite-web/tests/`. Proven by TWO oracles, because a grep alone false-greens on a rename (Murat): **(a) structural** — a guard test asserts `auth.setup.ts` never calls `context.addCookies`/`request` with a **session-shaped** cookie (it legitimately still writes only the non-auth `lang` cookie); **(b) provenance** — every persisted `refresh_token` must originate from a real 200 `/api/auth/login` `Set-Cookie`. The literal-string grep for `stub-session-token-for-phase-0` is kept as a cheap tripwire (necessary, not sufficient); the guard file references the literal via a single named constant so it does not self-match.
- **And** `cross-subdomain/cookie-sharing.spec.ts` is updated to assert the **real** cookie name `refresh_token` (not the retired `classlite_session`) and drops the fixed stub-value equality. (This spec only inspects the cookie jar — it does **not** navigate the SPA — so it does not trigger a boot-refresh rotation; see Dev Notes "rotation".)

### AC2 — Role-scoped 404 non-disclosure (7-2a axis) — same-tenant via `teacher2`, with a positive control
- **Given** an authenticated **owning** teacher's storageState (the seeded `teacher`, who owns the center's classes),
- **When** `/students/:id` loads for a student in that teacher's own class,
- **Then** `GET /api/students/{id}` returns **200** and the detail renders.
- **Given** an authenticated **non-owning** teacher's storageState — the newly-seeded `teacher2`, a valid member of the **same** center assigned to **no** class (Task 1b),
- **When FIRST a positive control runs** — `teacher2` hits an authenticated route it IS entitled to (e.g. `GET /api/students` list, which returns **200** with `teacher2`'s empty in-scope set) — proving the session is genuinely live (guards against a 404-for-the-wrong-reason: an unauthenticated request also "isn't 200"),
- **And then** the out-of-scope student detail is requested,
- **Then** `GET /api/students/{id}` returns **404** with error body `code === "STUDENT_NOT_FOUND"` (assert the body code, never a loose "not-found UI") — a TRUE same-tenant role-scope non-disclosure, never 403, matching 7-2a's axis exactly (`student_service.go:367`; mirrors `student_handler_atdd_test.go:103`'s zero-class out-of-scope teacher).

### AC3 — R-11-3 negative: session-minting unreachable in a non-test build (structural is the primary proof)
- **Given** the harness's session logic is isolated in `tests/e2e/lib/auth-harness.ts`,
- **Then the PRIMARY, load-bearing guarantee** is **structural unreachability**: an automated test proves **no `src/**` module imports `auth-harness`** (resolve the actual import graph / a dependency-cruiser rule, or scan the built Vite bundle for the module's marker — NOT merely re-reading that `tsconfig.app.json` `include` excludes `tests/`). The harness therefore cannot be in any production bundle. This assertion is the real R-11-3 discharge (score 6) and **carries equal red-phase weight** (Task 0).
- **And** as belt-and-suspenders, `guardNotProduction(config)` throws when the target is **production-shaped** — defined concretely as a host **outside** the allowlist `{localhost, *.classlite.localhost, *.classlite.app-staging}` — so the real-login harness can never be aimed at a production URL. "production base URL" is this negated allowlist, not an invented flag.
- **And** the guard is proven by a **pair** (so a throw-stub can't false-green, Murat): a production-shaped target **throws**, AND a development target does **NOT** throw and proceeds to a real login. The red-phase checklist shows the *dev-proceeds* assertion red first against the throw-stub.
- **Note:** recon confirmed there is **no server-side mint path** (`ExtractTenant` is Bearer-only; `MintAccessToken` is in-process center-creation only) — so "refuses to mint against prod" is really "refuses to run a real login against prod," a tripwire, not the core proof. The core proof is the structural exclusion above.
- **This is the WF-8 red-phase test** (vitest on the harness code, per `test-design-architecture.md:242` — NOT Playwright-on-Playwright).

### AC4 — Refresh-rotation resilience (deterministic, and actually exercised)
- **Given** every `POST /api/auth/refresh` rotates and **deletes** the presented token, and a reused deleted token triggers family revocation (`auth_refresh.go:49`, `:125`),
- **When** a context's boot-refresh receives a non-2xx (stale cookie / revoked family),
- **Then** the harness detects it and **re-authenticates deterministically** via a fresh `POST /api/auth/login`, rewrites that session file, and the consuming context is re-created from the new state (rewriting the file does NOT heal an already-loaded context — the test must re-create it).
- **And** this is **exercised, not just claimed**: a focused test **induces** a dead-cookie state (persist a storageState, delete/garble its `refresh_token`, or present it twice to force revocation) and asserts the harness recovers to a live session — so `reauthenticate` is covered, not dead infra.
- **And** the rotation hazard + the enforced mitigation are documented (Dev Notes "rotation"): **one session file per consuming context, no shared rotating default**; `--workers=1` for the authenticated lane; full parallel-safe pooling is 11-5a's.

### AC5 — E2E red-phase convention documented
- **Given** `docs/bmad-story-conventions.md`,
- **Then** it documents the **E2E red-phase convention**: an E2E/harness spec imports a not-yet-existing fixture/harness module so `tsc -b` (which covers `tests/e2e/**` via `tsconfig.e2e.json`) goes red with `TS2307`; vitest harness `*.test.ts` go red-by-assertion against the missing seam. (Mandated by `epic-11.md:453`.)

### AC6 — Gates green + make-or-break preconditions are enforced, not documented
- `npx tsc -b` clean (the real typecheck gate — covers `src` AND `tests/e2e`; `tsc --noEmit` false-greens, see [[reference_web_typecheck_gate_is_tsc_b]]).
- `npm test` (vitest) green, including the new harness `*.test.ts` and the no-stub guard.
- `npm run lint` clean.
- **The `setup` project logs in ONLY the identities the specs consume** — tenant-A `teacher` + tenant-A `teacher2` (AC2), reused for the other projects' states — **not "all seeded roles."** That is ≤3 serial logins, retry-safe under the burst-8/IP login limiter even with CI `retries:2` (see Dev Notes "rate limiter"). Logging in all 10 manifest entries would 429 — do not.
- **Two env vars are HARD preconditions, asserted fail-fast in `auth.setup.ts` (not left to docs):** `COOKIE_DOMAIN=.classlite.localhost` on the API (else the captured cookie's domain is wrong and every project boots silently un-authenticated) — setup asserts the captured cookie domain `=== ".classlite.localhost"` and throws otherwise; and `APP_ENV=development` on the API (else the cookie is `Secure` and `http://…localhost` can't send it). A running, **seeded** API on `:8080` is required — Playwright's `webServer` starts only Vite/Storybook, so the setup project hard-fails without it; this is a stated precondition, not a footnote.

### AC7 — Every authenticated project is PROVEN to boot a live session (anti-silent-green)
- **Given** a persisted storageState from AC1,
- **Then** a setup-time smoke asserts it actually boots authenticated: on the **dashboard host** (`my.classlite.localhost`), loading the SPA re-mints a session (boot-refresh yields a 200 `/api/auth/refresh` and an authed shell renders, not the `/login` redirect); and on the **cross-subdomain host** (`classlite.localhost`) the `refresh_token` cookie is visible (proves the `.classlite.localhost` Domain carried). This is the guard against the exact three-month blind spot — "performed a login POST" must not be mistaken for "the project tests a genuine session."

## Tasks / Subtasks

- [x] **Task 0 — WF-8 red-phase ATDD (MANDATORY before in-progress)** (AC3) — pre-generated & red-verified by `/bmad-tea AT 11-2` (2026-10-13).
  - [x] `tests/e2e/lib/auth-harness.test.ts` **imports `./auth-harness`** (not yet created) → `tsc -b` red `TS2307`. Asserts the R-11-3 PAIR: prod-shaped target → `guardNotProduction` throws; dev target → does NOT throw. (Deliberate env deviation: DEFAULT jsdom, not node — `node:fs` resolves under jsdom and the shared setup is jsdom-targeted; avoids a red-for-infra crash.)
  - [x] Write the **structural unreachability** test (`harness-unreachable.test.ts`): no `src/**` imports `auth-harness` (fs import-scan — dependency-cruiser is NOT installed). Red first via TS2307.
  - [x] Extend `vitest.config.ts` `include` with `tests/e2e/**/*.test.ts` (NOT `*.spec.ts`). `vitest-setup.ts` runs fine under these pure-logic/fs files (jsdom env).
  - [x] Record the red-phase checklist at `_bmad-output/test-artifacts/atdd-checklist-11-2.md`.
- [x] **Task 1b — Seed `teacher2` (backend, D1)** (AC2)
  - [x] `classlite-api/internal/seed/dataset.go`: added roleSpec `{"teacher", 6, "teacher2", "Teacher Two Fixture", true}` — a `center_members` row (role `teacher`) assigned to **NO** class → out-of-scope for every student in the center.
  - [x] Replaced the positional creds gate `if r.n <= 4` with an explicit per-roleSpec `creds bool` flag (owner/admin/teacher/**teacher2**/student1 = true; student2 = false) so `teacher2` reaches `credentials.json`.
  - [x] **Regenerated `GoldenDigest` (hash.go) with a delta-check** (Winston): seed + superuser row audit confirmed members/users 5→6 per tenant, the only new hashed rows are teacher2 (`…006`) user + member; every other hashed table byte-identical. `ea513805…→c45d0f6b…`. `teacher2` lands in **both** tenants.
  - [x] Re-ran 11-1a's seed suite — green (both `-tags=atdd_red_phase` and normal). `seed_credentials_atdd_test.go` is role-set-based → passed unchanged; only `seed_determinism_atdd_test.go`'s golden assertion needed the new constant. Added the back-reference to 11-1a's change log.
- [x] **Task 1 — Extract the testable harness module** (AC1, AC3, AC4)
  - [x] Created `tests/e2e/lib/auth-harness.ts`: `loadCredentials()` (reads `.auth/credentials.json`), `loginAndCaptureSession(request, cred)` (real login only — asserts ok + jar gained `refresh_token`, else throws), `guardNotProduction(config)` (throws unless host ∈ `{localhost, *.classlite.localhost, *.classlite.app-staging}`), `reauthenticate(request, cred)`, plus `sessionFileFor`/`sessionSlug`, `HARNESS_MODULE_ID`, `credentialsManifestExists`, and the `REFRESH_COOKIE_NAME`/`EXPECTED_COOKIE_DOMAIN` constants.
  - [x] `guardNotProduction` dev-proceeds was red-first via the module's absence (TS2307); the real allowlist greens it (not a throw-stub tautology). PAIR verified green.
- [x] **Task 2 — Rewrite `auth.setup.ts`** (AC1, AC6, AC7)
  - [x] Replaced the stub `addCookies` block: `guardNotProduction(config)` → for each consumed identity (tenant-A `teacher`, `teacher2`) a fresh APIRequestContext → `loginAndCaptureSession` → persist a per-identity file via `sessionFileFor` (merged with the non-auth `lang` cookie). NO shared rotating `auth.json`.
  - [x] Fail-fast: asserts the captured cookie name `refresh_token`, domain `.classlite.localhost` (COOKIE_DOMAIN), and `secure===false` (APP_ENV=development) with clear messages.
  - [x] Keeps the non-auth `lang=en` cookie (merged into each persisted state; login never sets it).
  - [x] Added the AC7 setup-time boot smoke: proves the persisted state boots a live session (200 boot-refresh on the dashboard host + `refresh_token` visible on the cross-subdomain host).
- [x] **Task 3 — Per-role storageState wiring in `playwright.config.ts`** (AC2, AC4, AC7)
  - [x] Retired the shared `.playwright/auth.json`; authenticated projects read the per-identity teacher state (computed via the pure `sessionSlug` so config-eval never reads the maybe-absent manifest). Cookie-jar-only specs don't rotate; SPA-booting specs mint fresh (below).
  - [x] role-scope mints a FRESH per-context session via `loginAndCaptureSession(context.request, cred)` — rotation-proof, named in the spec header — instead of reusing a frozen single-use file.
  - [x] `--workers=1` for the authenticated lane (documented in README + `manual-setup.md`).
- [x] **Task 4 — Role-scope 404 spec** (AC2, AC7)
  - [x] `tests/e2e/dashboard/role-scope.spec.ts`: owning `teacher` → `GET /api/students/{id}` 200; `teacher2` positive control → `GET /api/students` 200 (live session), THEN out-of-scope `GET /api/students/{id}` → 404 body `code === "STUDENT_NOT_FOUND"` (combined into one live teacher2 session). Student UUID resolved to the seed's deterministic `00000001-000a-4000-8000-000000000004` (student1, tenant A). Also added the AC4 induced-dead-cookie recovery test exercising `reauthenticate`.
- [x] **Task 5 — Fix the stub-dependent spec + the guards** (AC1)
  - [x] `cross-subdomain/cookie-sharing.spec.ts`: asserts `refresh_token` + domain `.classlite.localhost`, drops the stub-value equality, keeps `lang`; hard-preconditions `COOKIE_DOMAIN` (skip-with-reason if unset).
  - [x] `tests/e2e/lib/no-stub-guard.test.ts` (pre-generated): structural `addCookies`-shape guard + literal tripwire — now GREEN after Task 2 removed the fabrication.
- [x] **Task 6 — Docs** (AC5)
  - [x] `docs/bmad-story-conventions.md`: new "E2E red-phase convention" section.
  - [x] `classlite-web/tests/e2e/README.md`: deleted the "Story 1.5 follow-up" TODO; documented the real-login flow, one-file-per-context + single-use-against-rotation rule, the `COOKIE_DOMAIN`/`APP_ENV`/seeded-API preconditions, `--workers=1`, and the CI-doesn't-run-Playwright note (11-5a owns the CI gate).
  - [x] `docs/manual-setup.md`: added the real-auth E2E lane prerequisite (seeded API on `:8080` + `COOKIE_DOMAIN` + `APP_ENV`), referencing the 11-1a resource-budget rows.
- [x] **Task 7 — Green the gates** (AC6): `tsc -b` clean; `npm test` (vitest) **313 files / 4033 passed** (manifest-contract test skips without the seed, runs 7/7 with it); `npm run lint` 0 errors; `go test ./internal/test/... ./internal/service/...` green on a fresh CI-faithful DB. **Live `setup`+`dashboard`+`cross-subdomain` run `--workers=1` against a seeded API (`APP_ENV=development`, `COOKIE_DOMAIN=.classlite.localhost`, `CORS_ORIGINS` covering the E2E hosts): 8 passed, 2 skipped** (the deferred 1-7c `dashboard-boots-in-vi`), incl. the AC7 boot smoke, AC2 owning-200/teacher2-positive-200/out-of-scope-404-STUDENT_NOT_FOUND, and the AC4 recovery. Three live-run fixes folded: ESM-safe `import.meta.url` (project is `type:module`), harness login sends an explicit `Origin` (+`CORS_ORIGINS` precondition), one-boot-per-context (SPA refresh debounce).

### Review Findings

_Code review 2026-10-13 (Amelia / `/bmad-code-review 11-2`). 3 adversarial layers (Blind Hunter, Edge Case Hunter, Acceptance Auditor). 8 patch, 3 defer, 8 dismissed. WF-8 gates independently re-run green by the auditor (`tsc -b` exit 0; `vitest tests/e2e/lib` 7/7)._

**Patch — unambiguous fixes (unchecked):**

- [x] [Review][Patch] AC4 refresh waits omit the `method === 'POST'` filter the AC7 smoke uses — a cross-origin preflight `OPTIONS /api/auth/refresh` (or any non-POST) can be the first matching response, so `liveRefresh.status()` sees 204 not 200 (flaky false-red) and `deadRefresh`'s `.not.toBe(200)` passes for the wrong response [classlite-web/tests/e2e/dashboard/role-scope.spec.ts:896,920]
- [x] [Review][Patch] Student-detail `waitForResponse` uses full-URL glob `**/api/students/${id}` (matches query string too) while the sibling positive-control uses the robust `new URL(r.url()).pathname ===` form — a future `?include=` query times out instead of asserting 200/404 [classlite-web/tests/e2e/dashboard/role-scope.spec.ts:819,854]
- [x] [Review][Patch] `owningTeacher!`/`nonOwningTeacher!` non-null assertions + top-level `loadCredentials()` run at collection: a missing manifest hard-crashes the whole `dashboard` project (no skip-with-reason), and a present-but-partial seed passes `undefined` into `loginAndCaptureSession` → cryptic `undefined.email` instead of the directive error `consumedIdentities` gives [classlite-web/tests/e2e/dashboard/role-scope.spec.ts:790-797]
- [x] [Review][Patch] Manually-created browser contexts leak on any failure path — `context.close()` runs only on the success path (no try/finally), so a throwing `expect`/`goto`/login leaves the context (and its live server session) open [classlite-web/tests/e2e/dashboard/role-scope.spec.ts:810,891,914]
- [x] [Review][Patch] The two `setup()` tests (write-state, then boot-read-state) can race under `fullyParallel: true` if `--workers=1` is forgotten — add `test.describe.configure({ mode: 'serial' })` (or combine) so setup ordering does not depend on the operator flag [classlite-web/tests/e2e/auth.setup.ts:445,492]
- [x] [Review][Patch] `no-stub-guard` structural regex `/addCookies\s*\(([\s\S]*?)\)/` stops at the first `)`, so a session-cookie name after a nested paren (e.g. `addCookies([{domain: f(), name: 'refresh_token'}])`) evades the AC1 anti-stub oracle [classlite-web/tests/e2e/lib/no-stub-guard.test.ts:1099]
- [x] [Review][Patch] `loadCredentials` wraps only `readFileSync` in try/catch; `JSON.parse(raw)` is outside it, so a malformed/truncated manifest throws a raw `SyntaxError` instead of the actionable "re-run the seed" message [classlite-web/tests/e2e/lib/auth-harness.ts:1288]
- [x] [Review][Patch] Misleading rate-limit comment: `auth.setup.ts` claims "≤2 serial logins … well under burst-8/IP even with CI retries:2", but the full `setup`+`dashboard`+`cross-subdomain` lane fires ~7 real logins (7≤8 clean, NOT retry-safe) — correct the comment to the true total and that retry-safety awaits 11-5a [classlite-web/tests/e2e/auth.setup.ts:360-363]

**Defer — real, but the robust fix belongs elsewhere (checked):**

- [x] [Review][Defer] Lane login count (~7) fits burst-8 for one clean local run but is NOT retry-safe; the parallel-safe per-context session pool + CI wiring (`retries:2`) that makes it so is explicitly Story 11-5a — deferred, out-of-scope per the story's Out of Scope section
- [x] [Review][Defer] The AC7 smoke boots+rotates the shared `AUTH_STATE_TEACHER` state, so the on-disk file holds a server-dead token after setup; survivable only because every booting spec mints fresh and cross-subdomain compares jar values — robust fix is 11-5a's session pool — deferred, out-of-scope
- [x] [Review][Defer] `guardNotProduction` staging allowlist matches the `classlite.app-staging` suffix — verify this is the actual staging hostname; if staging is e.g. `*.staging.classlite.app` the allowlist wrongly BLOCKS legit staging E2E (false-negative) — deferred, needs the real staging host confirmed [classlite-web/tests/e2e/lib/auth-harness.ts:1303]

**Dismissed (8):** Go `GoldenDigest` "asserted-by-comment" (disproved — every hash query `ORDER BY`s a stable key, so adding teacher2 adds exactly 1 users + 1 center_members row; reorder is hash-neutral); config↔seed literal coupling (verified exact match today; divergence is a loud file-not-found, not a silent pass); `harness-unreachable` basename scan (accepted ATDD substitute, depcruise not installed, confidence 8); AC4 fixed `DEAD_STATE_FILE` path/no-cleanup (overwritten each run, `--workers=1`); AC2 positive-control+404 in separate contexts (justified documented deviation; the 404 context calling the API proves live boot); AC1 provenance oracle "collapsed" (provenance is inherently runtime — enforced by `loginAndCaptureSession` throwing on non-2xx/cookieless); `dashboard-boots-in-vi` `.fixme` (intended documented deferral to 11-5a); AC7 boot-proof only teacher/desktop (moot — mobile/landing have no specs).

## Dev Notes

### The architecture that makes this work (read first)
The SPA does **not** store the access token in a cookie or localStorage — it lives in the TanStack Query cache `['auth','session']` (in-memory) and is attached as `Authorization: Bearer` by `src/lib/api-fetch.ts` (TS-8). A Playwright `storageState` only persists cookies + localStorage. The bridge is the **boot-refresh**:
- `src/App.tsx:60-72` — on first mount, if `getQueryData(['auth','session']) === undefined`, fires `runBootProbe()`.
- `src/lib/auth-refresh.ts:273-277` — `performNetworkRefresh()` does `fetch('/api/auth/refresh', {method:'POST', credentials:'include'})`, then hydrates `['auth','session']` with `{user, accessToken, role, center}`.

So a **cold load carrying only the `refresh_token` cookie boots authenticated**. storageState needs that one cookie and nothing else (localStorage `classlite_last_refreshed_at` is a cross-tab debounce, not a boot requirement). **Winston traced the full path and confirmed it works — conditional on the two env vars below.**

### The real auth contract (exact, verified)
- **`POST /api/auth/login`** — body `{email,password,rememberMe}`; rate-limited per IP (`rate.Every(2min)`, **burst 8**), public. Returns `accessToken` in the **JSON body** (enveloped) **AND** `Set-Cookie: refresh_token=...`. [`auth_handler.go:329`]
- **Refresh cookie** = `refresh_token`, `HttpOnly`, `Path=/`, `SameSite=Lax`, `Domain=<pickCookieDomain>`, `Max-Age` 7d/30d, `Secure` only when `AppEnv != "development"`. [`auth_handler.go:453`, `main.go:244`]
- **`POST /api/auth/refresh`** — reads the `refresh_token` cookie, returns a new access token in the body + a **rotated** `refresh_token`; NOT rate-limited. [`auth_handler.go:360`]
- **`ExtractTenant`** authenticates protected endpoints **only** via `Authorization: Bearer`. [`middleware/auth.go:41`]
- **No backdoor.** `MintAccessToken` is in-process center-creation only; test-token minting is `_test.go`/`internal/test/*` only, never wired to `cmd/api/main.go`.

### Cookie Domain + Secure — the two make-or-break env vars (corrected)
- Vite proxies `/api → http://localhost:8080` (`vite.config.ts:15`) with `changeOrigin`; login/refresh are same-origin to the dashboard host.
- `pickCookieDomain` (`main.go:1196`) in dev returns `cfg.CookieDomain` **verbatim**, and `cfg.CookieDomain` defaults to `"localhost"` (`config.go:165`), so the server emits an **explicit `Domain=localhost`** (`auth_handler.go:847-853`) — **NOT host-only, and whether it reaches `my.classlite.localhost` is browser-dependent RFC-6265 suffix murk.** The earlier "default is fine for dashboard/mobile" claim was wrong. **`COOKIE_DOMAIN=.classlite.localhost` is a HARD prerequisite for the entire authenticated lane**, not just cross-subdomain — it makes the cookie reliably domain-match on every `*.classlite.localhost` host. AC6 asserts the captured domain fail-fast.
- **`APP_ENV=development`** is the second hard prerequisite: any other value flips the cookie to `Secure`, and `http://…localhost` silently won't send it → green setup, logged-out boot. AC6 covers this.

### Rotation + reuse detection — one file per context, no shared default (D2, corrected)
`POST /api/auth/refresh` always rotates: `RotateRefreshToken` DELETEs the presented token and INSERTs a successor (`auth_refresh.go:49`). Presenting a **deleted** token while a sibling exists → `handleRefreshMiss` (`:125`) → **family revoked**. So a persisted `refresh_token` is **single-use against a rotating server**: the moment a second context loads the same frozen file and boots, it revokes the family and kills both sessions. `--workers=1` only serializes this — it does NOT prevent it. Therefore **no shared `auth.json` across SPA-booting contexts** (the original draft kept one — that was the landmine Murat caught). The rule: one session file per consuming context; a file is consumed once; specs that merely read the cookie jar (cookie-sharing) don't boot and don't rotate. The full parallel-safe session pool (and the CI multi-worker lane) is 11-5a's — R-11-5 is NOT closed here.

### Rate limiter — recomputed after D1 (corrected)
`credentials.go` emits one row per member per center; with `teacher2` the manifest is **10 entries** (2 tenants × 5 creds roles). The login limiter is burst **8**/IP, refill 1/2min. **Logging in all 10 would 429** — and CI `retries:2` would re-run setup inside the 2-min window and compound it. So the `setup` project logs in **only the consumed identities**: tenant-A `teacher` + tenant-A `teacher2` (+ reuse for other projects) = ≤3 serial logins, retry-safe. The old "exactly 8" note was invalidated by D1 — do not authenticate the whole manifest. Mid-run recovery (AC4) prefers `/refresh` (unlimited) and only re-`/login`s when a family is dead.

### AC2 reality — `teacher2` is faithful to 7-2a (verified by two reviewers)
One teacher per center owns every class; the 7-2a fixture uses a second, **zero-class** out-of-scope teacher and gets 404. `teacherScope` returns the teacher's own UUID (`student_service.go:761`); `GetStudentDetail` 404s a teacher with zero caller-visible classes (`student_service.go:367`). There is **no center-wide teacher read path**. So `teacher2` (teaches no class) is guaranteed to 404 `STUDENT_NOT_FOUND` on every student in its center — a true same-tenant role-scope 404. The positive control (AC2) exists because an *unauthenticated* request also isn't 200 — without it, a broken `teacher2` session would pass AC2 for the wrong reason.

### Runner split (do not cross the streams)
Playwright owns `tests/e2e/**/*.spec.ts`; vitest scans `src/**` only. The harness unit tests are `*.test.ts` under `tests/e2e/lib/`; add `tests/e2e/**/*.test.ts` (NOT `*.spec.ts`) to vitest `include` so vitest runs them and Playwright never sees them. (Verified: root `tsconfig.json` references `tsconfig.e2e.json` which includes `tests/e2e/**/*.ts`, so the `tsc -b` red-phase holds.)

### Red-phase convention (this repo) — see [[reference_atdd_red_convention]]
FE/vitest: import the not-yet-existing module → `tsc -b` red (`TS2307`); pure-logic suites run and fail red-by-assertion. `tsc -b` is the real gate ([[reference_web_typecheck_gate_is_tsc_b]]). Document every green-phase SEAM in the test header block.

### ATDD red-phase scaffolds ALREADY GENERATED (`/bmad-tea AT 11-2`, 2026-10-13)
The WF-8 red tests exist on the branch and are **red-verified**. Checklist + full SEAMS: `_bmad-output/test-artifacts/atdd-checklist-11-2.md`.
- `classlite-web/tests/e2e/lib/auth-harness.test.ts` — AC3 guard PAIR (prod-throws / **dev-proceeds** red-first) + AC1 manifest contract. RED via TS2307.
- `classlite-web/tests/e2e/lib/harness-unreachable.test.ts` — AC3 PRIMARY proof (no `src/**` imports the harness; fs scan, no dependency-cruiser). RED via TS2307.
- `classlite-web/tests/e2e/lib/no-stub-guard.test.ts` — AC1 tripwire + structural `addCookies` guard. **BEHAVIORAL RED** against today's stub (`expected ['tests/e2e/auth.setup.ts'] to deeply equal []`).
- `classlite-web/tests/e2e/dashboard/role-scope.spec.ts` — AC2/AC7 (owning 200 · teacher2 positive-control 200 · out-of-scope 404 `STUDENT_NOT_FOUND`). RED via TS2307 (the AC5 E2E-convention demo).
- `classlite-web/vitest.config.ts` — `include` extended with the recursive `tests/e2e` `*.test.ts` glob so the harness tests are collected (red, not inert).
- **DEVIATION from Task 0 (deliberate, safer):** the harness `*.test.ts` use the DEFAULT jsdom env, NOT `// @vitest-environment node` — `node:fs` resolves under jsdom in vitest and the shared `vitest-setup.ts` is jsdom-targeted, so node env risks a red-for-infra setup crash. Pure-logic + fs tests don't need the DOM.
- **Green entry:** implement the SEAMs in the checklist; `role-scope.spec.ts` has two `<SEED_STUDENT_IN_TEACHER_CLASS>` placeholders to resolve from the seed's deterministic UUIDs.
- **Branch is intentionally RED** (`tsc -b` + `npm test`) until green — this IS the WF-8 gate. Investigated 2026-10-13: `tsc -b --force` on a clean tree is GREEN except these 7 intentional 11-2 errors — the dashboards/`ClassFormDialog`/`attemptReadOnly` diagnostics were **stale LSP snapshots, NOT real `tsc -b` failures** (`BillingSummary` exists at `client.ts:2925`; `readOnlyBannerCopy` is used). So 11-2's green transition = a fully clean `tsc -b`. Separate finding (not 11-2's to fix): `ci-web.yml:68` `npx tsc --noEmit` is a false-green (empty program on the solution root); the real typecheck is the `tsc -b` inside `npm run build` (line 81). → see [[reference_web_typecheck_gate_is_tsc_b]] / FU below.

### Project Structure Notes
- NEW: `tests/e2e/lib/auth-harness.ts`, `tests/e2e/lib/auth-harness.test.ts`, `tests/e2e/lib/no-stub-guard.test.ts`, `tests/e2e/dashboard/role-scope.spec.ts`; a dependency-cruiser rule (or equivalent) for the AC3 structural check.
- UPDATE: `tests/e2e/auth.setup.ts`, `tests/e2e/cross-subdomain/cookie-sharing.spec.ts`, `playwright.config.ts`, `vitest.config.ts`, `tests/e2e/README.md`, `docs/bmad-story-conventions.md`, `docs/manual-setup.md`.
- `.gitignore` already ignores `classlite-web/.playwright/` and `classlite-web/tests/e2e/.auth/`.
- Primarily **frontend/E2E + docs**, plus a small **backend seed** edit (D1): `classlite-api/internal/seed/dataset.go` + `internal/seed/hash.go` (digest regen, delta-checked). Still **NO** `api.yaml`, migration, sqlc, or `codegen.sh`.

### References
- [Source: epic-11.md#Story 11-2] — the 4 ACs, "named by path", done-when (epic:637).
- [Source: test-design-architecture.md:235] — R-11-3 (score 6); :242 — red phase = vitest/Go on harness code; :237 — R-11-5 runtime wiring = 11-2/11-5a.
- [Source: src/App.tsx:60] + [src/lib/auth-refresh.ts:273] — boot-refresh.
- [Source: auth_handler.go:329/360/453] + [main.go:244/1196] + [config.go:165] — login/refresh/cookie/domain/Secure.
- [Source: middleware/auth.go:41] — Bearer-only auth.
- [Source: student_service.go:367/761] + [student_handler_atdd_test.go:103] — 7-2a 404 scope.
- [Source: internal/seed/dataset.go:58/83] + [credentials.go] + [hash.go:21/33] + [seed_credentials_atdd_test.go:52] — seed roster, creds gate (role-set-based), golden digest.
- [Source: tests/e2e/auth.setup.ts:33] + [playwright.config.ts] + [vitest.config.ts] — the stub + runner wiring.

## Definition of Done
- All ACs met. AC3: the **structural unreachability** test is the primary R-11-3 proof and was red first; the guard PAIR (prod-throws / dev-proceeds) green with dev-proceeds red first.
- No fabricated session value under `classlite-web/tests/` — proven by the structural `addCookies` guard + provenance, with the grep as a tripwire.
- AC2 asserts the positive control (live `teacher2` session) before the 404, and asserts the `STUDENT_NOT_FOUND` body code.
- AC7: each authenticated project is proven to boot a live session; `auth.setup.ts` fails fast if `COOKIE_DOMAIN`/`APP_ENV` are wrong.
- `setup` logs in only consumed identities (≤3), retry-safe under burst-8.
- `tsc -b`, `npm test`, `npm run lint` clean; a documented local `setup` run boots authenticated against a seeded API.
- `docs/bmad-story-conventions.md` E2E red-phase convention + README TODO retirement landed.
- R-11-5 is **NOT** closed here (parallel matrix + CI gate are 11-5a); 11-2 is necessary-not-sufficient for the Playwright rot's root cause (CI never runs it — 11-5a lands the CI gate). 11-1a's change log back-references the digest regen.
- Completion notes + File List in `11-2-real-auth-e2e-harness-completion-notes.md` per [[bmad-story-conventions]].

## Out of Scope
- The full parallel-worker-safe multi-session pool + the money-path smoke → **11-5a**.
- The Playwright CI gate + quarantine lane → **11-5a** (supersedes FU-11-CI). *(Note: 11-2's harness runs `--workers=1` locally and is not wired into CI — CI does not run Playwright at all today, so 11-2 adds no CI regression, but the rot's named root cause is closed by 11-5a, not here.)*
- The 87-screen Playwright grid → **11-5b**.
- Seeding Epic 9/10 entities → **11-1b**.
- Any server-side auth change (login/refresh/middleware/seed-schema consumed as-is; the only backend edit is the additive `teacher2` seed row).

## Change Log
| Date | Change | By |
|---|---|---|
| 2026-10-13 | Story created (backlog → ready-for-dev). 2-agent recon confirmed the boot-refresh bridge, the real `refresh_token` contract, no server backdoor, the one-teacher-per-center gap, the rotation/reuse-detection hazard. **D1 RULED:** seed same-tenant `teacher2`. **D2 RULED:** bounded here, full matrix → 11-5a. | Amelia |
| 2026-10-13 | **Implemented (dev-story, Amelia).** All 8 ACs green; WF-8 red→green transition done (the 4 ATDD scaffolds now green, `role-scope.spec.ts` rewritten). Seeded `teacher2` (D1) + delta-checked `GoldenDigest` regen (`ea513805…→c45d0f6b…`; 11-1a change-log back-referenced). New `auth-harness.ts` (real login only, guard PAIR, reauthenticate, per-identity state); `auth.setup.ts` real login + AC7 boot smoke; per-identity storageState wiring (retired `.playwright/auth.json`); cookie-sharing on the real `refresh_token`; E2E red-phase convention + README/manual-setup docs. **Gates:** `tsc -b` clean · `npm test` 313/4033 · `npm run lint` 0 errors · Go suite green on a fresh CI DB · **live Playwright lane 8 passed / 2 skipped** (AC7 smoke + AC2 200/200/404-STUDENT_NOT_FOUND + AC4 recovery, against a seeded API). Three live-run fixes folded: ESM `import.meta.url`, explicit login `Origin` (+`CORS_ORIGINS` precondition), one-boot-per-context (SPA refresh debounce). **Deferred:** the 1-7c `dashboard-boots-in-vi` (2 tests) → `test.describe.fixme` (needs 11-5a's parallel-safe session pool; incompatible with real token rotation). Dev Agent Record + File List in `11-2-real-auth-e2e-harness-completion-notes.md`. Status → review. | Amelia (dev-story) |
| 2026-10-13 | Party-mode adversarial spec review (Murat/Winston/Mary, independent Opus subagents). Folded all convergent findings: **(blocker, all three)** D1's `teacher2` pushed the manifest to 10 entries — `setup` now logs in only the ~3 consumed identities, not all roles (burst-8 retry-safe); **(blocker, Murat)** removed the shared rotating `auth.json` default (family-revocation landmine) → literal one-file-per-context; **(all three)** AC3 reframed so the **structural bundle-exclusion** test is the primary R-11-3 proof + a prod/dev guard PAIR kills the throw-stub false-green; **(Mary/Winston)** new AC7 — every authenticated project proven to boot a live session, with `COOKIE_DOMAIN`/`APP_ENV` as fail-fast preconditions (corrected the false "default localhost is fine" claim); **(Murat/Winston)** AC2 gains a positive control + `STUDENT_NOT_FOUND` body assertion; **(Murat)** AC1 grep augmented with structural + provenance oracles; **(Murat)** AC4 `reauthenticate` now exercised by an induced-dead-cookie test; **(Winston)** GoldenDigest regen is delta-checked, and the 11-1a creds test verified role-set-based (passes unchanged). Validated-not-faulted: `teacher2` fidelity to 7-2a, the cookie path works given the env, runner split, `tsc -b` red-phase. | Amelia |
