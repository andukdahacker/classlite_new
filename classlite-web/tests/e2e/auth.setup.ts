import { expect, test as setup } from '@playwright/test'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import {
  EXPECTED_COOKIE_DOMAIN,
  guardNotProduction,
  loadCredentials,
  loginAndCaptureSession,
  originOf,
  REFRESH_COOKIE_NAME,
  sessionFileFor,
  type CredentialsEntry,
  type StorageState,
} from './lib/auth-harness'

/**
 * auth.setup — runs ONCE (the `setup` project) before every authenticated
 * Playwright project and persists a REAL session per consumed identity.
 *
 * Story 11-2 retired the fabricated `classlite_session` stub this file carried
 * for three months. Now each identity authenticates through the real
 * `POST /api/auth/login`; the real `refresh_token` Set-Cookie is captured into
 * a storageState that the SPA's boot-refresh turns into a live session.
 *
 * ONLY the identities the specs actually consume are logged in (AC6): tenant-A
 * `teacher` (owns classes) and tenant-A `teacher2` (zero classes, for the
 * role-scope 404). Logging in all seeded roles would 429.
 *
 * RATE-LIMIT REALITY (not just this file): the login limiter is burst-8 /
 * rate.Every(2min) / per-IP. This setup does 2 logins, but the full authed lane
 * also fires the rotation-proof per-context logins in `dashboard/role-scope`
 * (owning-200 + teacher2 positive-control + out-of-scope-404 = 3) and AC4
 * (initial mint + reauthenticate = 2) — ~7 real logins on 127.0.0.1 per run.
 * 7 ≤ 8 so ONE clean local run (`retries:0`) fits, but the lane is NOT yet
 * retry-safe: a single login-bearing retry tips past burst-8 → spurious 429.
 * The parallel-safe per-context session pool + CI wiring (`retries:2`) that
 * makes it retry-safe is Story 11-5a (see docs/manual-setup.md + README).
 *
 * One session file per identity (D2) — NO shared rotating default — because a
 * persisted `refresh_token` is single-use against a rotating server: a second
 * SPA-booting context presenting the same frozen cookie revokes the family.
 *
 * HARD PRECONDITIONS (asserted fail-fast below, not left to docs):
 *   - A running, SEEDED API on :8080 (Playwright's webServer starts only Vite).
 *   - COOKIE_DOMAIN=.classlite.localhost on the API — else the captured cookie's
 *     domain is wrong and every project boots silently un-authenticated.
 *   - APP_ENV=development on the API — else the cookie is `Secure` and
 *     `http://…localhost` can't send it (again: silent logged-out boot).
 */

// The non-auth language cookie the cross-subdomain i18n specs rely on (Story
// 1-7c). Login does NOT set it, so we merge it into each persisted state. It is
// NOT a session cookie, so the no-stub guard permits it.
const LANG_COOKIE: StorageState['cookies'][number] = {
  name: 'lang',
  value: 'en',
  domain: EXPECTED_COOKIE_DOMAIN,
  path: '/',
  expires: -1,
  httpOnly: false,
  secure: false,
  sameSite: 'Lax',
}

// The identities the specs consume, in login order. tenant A only (AC6).
const TENANT_A_SHORT_CODE = 'SEEDFAKEA'

function consumedIdentities(creds: CredentialsEntry[]): CredentialsEntry[] {
  const inTenantA = creds.filter((c) => c.centerShortCode === TENANT_A_SHORT_CODE)
  const teacher = inTenantA.find(
    (c) => c.role === 'teacher' && !c.email.includes('teacher2'),
  )
  const teacher2 = inTenantA.find(
    (c) => c.role === 'teacher' && c.email.includes('teacher2'),
  )
  if (!teacher || !teacher2) {
    throw new Error(
      'auth.setup: credentials.json is missing tenant-A teacher and/or teacher2 ' +
        '(Story 11-2 D1 seed). Re-run the seed so both identities are emitted.',
    )
  }
  return [teacher, teacher2]
}

// Serialize the two setup tests: the second ("…boots a live session") READS the
// storageState file the first WRITES. Under `fullyParallel: true` they would
// otherwise be eligible to run concurrently (the boot-read racing a missing /
// half-written file) if the lane is ever run without `--workers=1`. `serial`
// pins the write→boot ordering in-file so setup correctness never depends on
// the operator remembering the flag.
setup.describe.configure({ mode: 'serial' })

setup('authenticate real seeded identities', async ({ playwright, baseURL }) => {
  // Tripwire: never aim a real login at a production-shaped target (R-11-3 belt).
  guardNotProduction({ baseURL })

  const identities = consumedIdentities(loadCredentials())

  for (const cred of identities) {
    // A fresh APIRequestContext per identity so cookie jars never mix and each
    // persisted file carries exactly one identity's session.
    const api = await playwright.request.newContext({ baseURL })
    try {
      const { storageState, refreshCookie } = await loginAndCaptureSession(
        api,
        cred,
        { origin: originOf(baseURL) },
      )

      // Fail-fast on the two make-or-break env preconditions (AC6). A wrong
      // domain or a Secure cookie becomes a silent logged-out boot otherwise.
      expect(
        refreshCookie.name,
        'captured session cookie must be the real refresh_token',
      ).toBe(REFRESH_COOKIE_NAME)
      expect(
        refreshCookie.domain,
        `refresh_token domain must be ${EXPECTED_COOKIE_DOMAIN} — set COOKIE_DOMAIN=${EXPECTED_COOKIE_DOMAIN} on the API`,
      ).toBe(EXPECTED_COOKIE_DOMAIN)
      expect(
        refreshCookie.secure,
        'refresh_token must NOT be Secure over http://…localhost — set APP_ENV=development on the API',
      ).toBe(false)

      // Persist the real session + the non-auth lang cookie. No addCookies,
      // no fabricated value — the no-stub guard verifies this stays true.
      const persisted: StorageState = {
        cookies: [...storageState.cookies, LANG_COOKIE],
        origins: storageState.origins,
      }
      const path = sessionFileFor(cred)
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify(persisted, null, 2))
    } finally {
      await api.dispose()
    }
  }
})

setup('each persisted session boots a live authenticated session (AC7)', async ({
  browser,
  baseURL,
}) => {
  // Anti-silent-green: "performed a login POST" must not be mistaken for "the
  // project tests a genuine session." Prove the persisted state actually boots.
  const teacher = consumedIdentities(loadCredentials())[0]
  const context = await browser.newContext({
    baseURL,
    storageState: sessionFileFor(teacher),
  })
  try {
    const page = await context.newPage()

    // Dashboard host: a cold load carrying only refresh_token must re-mint a
    // session via boot-refresh (200 /api/auth/refresh) and land on an authed
    // shell — NOT the /login redirect.
    const bootRefresh = page.waitForResponse(
      (r) => r.url().includes('/api/auth/refresh') && r.request().method() === 'POST',
    )
    await page.goto('/dashboard')
    expect(
      (await bootRefresh).status(),
      'boot-refresh must return 200 — a non-2xx means the persisted session is dead/mis-scoped',
    ).toBe(200)
    await expect(
      page,
      'authed boot must not redirect to /login',
    ).not.toHaveURL(/\/login/)

    // Cross-subdomain host: the refresh_token must be visible on
    // classlite.localhost too (proves the .classlite.localhost Domain carried).
    const crossCookies = await context.cookies('http://classlite.localhost:4321/')
    expect(
      crossCookies.some((c) => c.name === REFRESH_COOKIE_NAME),
      'refresh_token must be visible on the cross-subdomain host (Domain=.classlite.localhost)',
    ).toBe(true)
  } finally {
    await context.close()
  }
})
