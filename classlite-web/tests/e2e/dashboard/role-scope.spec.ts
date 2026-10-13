/**
 * Story 11-2, AC2 + AC7 + AC4 — role-scope 404 non-disclosure (7-2a axis),
 * proven-live sessions, and rotation recovery.
 *
 * Playwright E2E (`.spec.ts` → the `dashboard` project; vitest never collects
 * it). It demonstrates the E2E red-phase convention (AC5): before Task 1 the
 * `../lib/auth-harness` import did not exist, so `tsc -b` went RED (TS2307).
 *
 * ROTATION-PROOF SESSIONING (the mechanism, per Task 3): a persisted
 * `refresh_token` is SINGLE-USE against the rotating refresh endpoint, so this
 * spec never reuses a frozen storageState across SPA-booting contexts. Instead
 * each browser context mints its OWN fresh session via `loginAndCaptureSession`
 * into the context's shared cookie jar (`context.request`), then the SPA's
 * boot-refresh turns that cookie into a live in-memory access token. `teacher`
 * and `teacher2` therefore never collide on a shared single-use token.
 *
 * PRECONDITIONS (AC6 — hard; the spec is meaningless without them):
 *   - API running + SEEDED on :8080 (Playwright's webServer starts only Vite).
 *   - COOKIE_DOMAIN=.classlite.localhost and APP_ENV=development on the API.
 *   - Run the authenticated lane with `--workers=1`.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { expect, test, type Browser, type APIRequestContext } from '@playwright/test'
import {
  loadCredentials,
  loginAndCaptureSession,
  originOf,
  reauthenticate,
  REFRESH_COOKIE_NAME,
  type CredentialsEntry,
} from '../lib/auth-harness'

const TENANT_A_SHORT_CODE = 'SEEDFAKEA'

// student1 in tenant A, enrolled in the owning teacher's active class — the
// seed's deterministic UUID (internal/seed: blockUser=00000001, letter=000a,
// n=4). In scope for the owning teacher (→ 200) and out of scope for the
// zero-class teacher2 (→ 404 STUDENT_NOT_FOUND).
const SEED_STUDENT_IN_TEACHER_CLASS = '00000001-000a-4000-8000-000000000004'

// Exact API paths the SPA calls — matched on pathname (NOT a `**` URL glob) so
// a query string the SPA may append (e.g. `?include=...`) can never turn a real
// 200/404 assertion into a false waitForResponse timeout.
const STUDENT_DETAIL_PATH = `/api/students/${SEED_STUDENT_IN_TEACHER_CLASS}`
const STUDENTS_LIST_PATH = '/api/students'
const REFRESH_PATH = '/api/auth/refresh'

const creds = loadCredentials()
const tenantA = creds.filter((c) => c.centerShortCode === TENANT_A_SHORT_CODE)

/**
 * requireTeacher resolves a tenant-A teacher identity from the manifest or
 * throws the SAME directive error `auth.setup`'s `consumedIdentities` gives. A
 * present-but-partial seed (e.g. teacher2 not yet emitted) must fail loudly with
 * "re-run the seed", never slip an `undefined` past a non-null assertion into
 * `loginAndCaptureSession` and surface as a cryptic `undefined.email`.
 */
function requireTeacher(
  predicate: (c: CredentialsEntry) => boolean,
  which: string,
): CredentialsEntry {
  const found = tenantA.find((c) => c.role === 'teacher' && predicate(c))
  if (!found) {
    throw new Error(
      `role-scope.spec: credentials.json is missing tenant-A ${which} ` +
        `(Story 11-2 D1 seed). Re-run the seed (classlite-api: scripts/seed.sh) ` +
        `so both teacher identities are emitted.`,
    )
  }
  return found
}

const owningTeacher = requireTeacher(
  (c) => !c.email.includes('teacher2'),
  'owning teacher',
)
const nonOwningTeacher = requireTeacher(
  (c) => c.email.includes('teacher2'),
  'teacher2',
)

/**
 * freshAuthedContext mints a NEW live session in a fresh browser context — the
 * rotation-proof alternative to reusing a frozen single-use storageState.
 * Logging in via `context.request` lands the real refresh_token in the
 * context's shared jar, so the next `page.goto` boots authenticated.
 */
async function freshAuthedContext(
  browser: Browser,
  baseURL: string | undefined,
  cred: CredentialsEntry,
) {
  const context = await browser.newContext({ baseURL })
  await loginAndCaptureSession(context.request, cred, { origin: originOf(baseURL) })
  return context
}

test.describe('11-2 AC2 — student detail is a same-tenant role-scope 404 (never 403)', () => {
  test('owning teacher sees their own student (200)', async ({ browser, baseURL }) => {
    const context = await freshAuthedContext(browser, baseURL, owningTeacher)
    try {
      const page = await context.newPage()
      const resp = page.waitForResponse(
        (r) => new URL(r.url()).pathname === STUDENT_DETAIL_PATH,
      )
      await page.goto(`/students/${SEED_STUDENT_IN_TEACHER_CLASS}`)
      expect((await resp).status()).toBe(200)
    } finally {
      await context.close()
    }
  })

  test('teacher2 — positive control (live 200) then out-of-scope 404 STUDENT_NOT_FOUND', async ({
    browser,
    baseURL,
  }) => {
    // AC2 proves BOTH halves for teacher2 (a positive control guards against a
    // 404-for-the-wrong-reason — an unauthenticated request also isn't 200).
    // Each half runs in its OWN fresh context with a SINGLE navigation: a second
    // full page.goto in the same context hits the SPA's last-refreshed debounce
    // (localStorage `classlite_last_refreshed_at`), which skips the boot-refresh
    // on reload → no session → guest shell → the role-denied page renders and no
    // student API call fires. One boot per context sidesteps that entirely.

    // Positive control: teacher2's session is genuinely live (200 on its own
    // in-scope — and empty — roster list).
    const posContext = await freshAuthedContext(browser, baseURL, nonOwningTeacher)
    try {
      const posPage = await posContext.newPage()
      const listResp = posPage.waitForResponse(
        (r) => new URL(r.url()).pathname === STUDENTS_LIST_PATH,
      )
      await posPage.goto('/students')
      expect((await listResp).status()).toBe(200)
    } finally {
      await posContext.close()
    }

    // Out-of-scope student detail: a TRUE same-tenant role-scope 404, asserted
    // on the body error code, never a loose not-found UI and never 403.
    const context = await freshAuthedContext(browser, baseURL, nonOwningTeacher)
    try {
      const page = await context.newPage()
      const detailResp = page.waitForResponse(
        (r) => new URL(r.url()).pathname === STUDENT_DETAIL_PATH,
      )
      await page.goto(`/students/${SEED_STUDENT_IN_TEACHER_CLASS}`)
      const detail = await detailResp
      expect(detail.status()).toBe(404)
      const body = (await detail.json()) as { error: { code: string } }
      expect(body.error.code).toBe('STUDENT_NOT_FOUND')
    } finally {
      await context.close()
    }
  })
})

test.describe('11-2 AC4 — rotation recovery via reauthenticate (exercised, not claimed)', () => {
  const DEAD_STATE_FILE = '.playwright/ac4-dead-recovery.json'

  test('a dead/garbled refresh cookie boots logged-out, then reauthenticate recovers a live session', async ({
    browser,
    baseURL,
    playwright,
  }) => {
    // 1. Mint a real session, then GARBLE its refresh_token so a boot-refresh
    //    from the persisted file fails (the induced dead-cookie state).
    const mintApi: APIRequestContext = await playwright.request.newContext({ baseURL })
    let minted: Awaited<ReturnType<typeof loginAndCaptureSession>>
    try {
      minted = await loginAndCaptureSession(mintApi, owningTeacher, {
        origin: originOf(baseURL),
      })
    } finally {
      await mintApi.dispose()
    }
    const { storageState } = minted
    const deadState = {
      ...storageState,
      cookies: storageState.cookies.map((c) =>
        c.name === REFRESH_COOKIE_NAME ? { ...c, value: `${c.value}-DEAD` } : c,
      ),
    }
    mkdirSync(dirname(DEAD_STATE_FILE), { recursive: true })
    writeFileSync(DEAD_STATE_FILE, JSON.stringify(deadState))

    // 2. A context loaded from the dead file must NOT boot authenticated. Match
    //    the POST boot-refresh only — a cross-origin CORS preflight
    //    `OPTIONS /api/auth/refresh` (204) would otherwise satisfy the wait
    //    first and we'd assert on the wrong response (mirrors the AC7 smoke).
    const deadContext = await browser.newContext({
      baseURL,
      storageState: DEAD_STATE_FILE,
    })
    try {
      const deadPage = await deadContext.newPage()
      const deadRefresh = deadPage.waitForResponse(
        (r) => r.url().includes(REFRESH_PATH) && r.request().method() === 'POST',
      )
      await deadPage.goto('/dashboard')
      expect(
        (await deadRefresh).status(),
        'boot-refresh with a dead cookie must be non-2xx',
      ).not.toBe(200)
    } finally {
      await deadContext.close()
    }

    // 3. reauthenticate → fresh state; the CALLER re-creates its context from
    //    it (rewriting the file does not heal an already-loaded context).
    const recoverApi: APIRequestContext = await playwright.request.newContext({ baseURL })
    let recovered: Awaited<ReturnType<typeof reauthenticate>>
    try {
      recovered = await reauthenticate(recoverApi, owningTeacher, {
        origin: originOf(baseURL),
      })
    } finally {
      await recoverApi.dispose()
    }
    writeFileSync(DEAD_STATE_FILE, JSON.stringify(recovered.storageState))

    const liveContext = await browser.newContext({
      baseURL,
      storageState: DEAD_STATE_FILE,
    })
    try {
      const livePage = await liveContext.newPage()
      const liveRefresh = livePage.waitForResponse(
        (r) => r.url().includes(REFRESH_PATH) && r.request().method() === 'POST',
      )
      await livePage.goto('/dashboard')
      expect(
        (await liveRefresh).status(),
        'recovered session must boot (200 boot-refresh)',
      ).toBe(200)
      await expect(livePage).not.toHaveURL(/\/login/)
    } finally {
      await liveContext.close()
    }
  })
})
