/**
 * Real-auth E2E harness (Story 11-2).
 *
 * This module is the ONE place the Playwright auth setup and the role-scope
 * specs reconcile with the real backend auth contract. It replaces the
 * three-month-old fabricated `classlite_session` stub: every session now
 * originates from a real `POST /api/auth/login` whose `refresh_token`
 * Set-Cookie is captured into a Playwright storageState.
 *
 * R-11-3 (WF-8, score 6): this file lives under `tests/` and is NEVER imported
 * by `src/**`, so it is structurally excluded from the Vite production bundle.
 * `harness-unreachable.test.ts` asserts that invariant — it is the primary,
 * load-bearing proof that no session-minting logic can ship in a prod build.
 * `guardNotProduction` is a belt-and-suspenders tripwire on top of it.
 *
 * The bridge that makes a cookie-only storageState boot authenticated: the SPA
 * keeps the access token in the TanStack Query cache (in-memory, not a cookie),
 * and on cold mount fires a boot-refresh (`App.tsx` → `performNetworkRefresh`)
 * that POSTs `/api/auth/refresh` with the `refresh_token` cookie and re-mints
 * the access token. So a context carrying only the real `refresh_token` cookie
 * boots logged-in — conditional on COOKIE_DOMAIN=.classlite.localhost and
 * APP_ENV=development on the API (asserted fail-fast in `auth.setup.ts`).
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { APIRequestContext } from '@playwright/test'

// ESM-safe module directory. The project is `"type": "module"` and Playwright
// loads this file (via playwright.config.ts + the specs) as a real ES module
// where `__dirname` is undefined; `import.meta.url` is the portable equivalent
// that also works under vitest.
const moduleDir = dirname(fileURLToPath(import.meta.url))

/**
 * HARNESS_MODULE_ID is the canonical specifier the structural-unreachability
 * guard (`harness-unreachable.test.ts`) scans the app source tree for. Keep it
 * equal to this module's import path so the guard matches a real import.
 */
export const HARNESS_MODULE_ID = 'tests/e2e/lib/auth-harness'

/** REFRESH_COOKIE_NAME is the real refresh-token cookie (`auth_handler.go`). */
export const REFRESH_COOKIE_NAME = 'refresh_token'

/**
 * EXPECTED_COOKIE_DOMAIN is the domain the captured refresh cookie MUST carry
 * for the authenticated lane to work on every `*.classlite.localhost` host.
 * The API emits it only when COOKIE_DOMAIN=.classlite.localhost is set; a wrong
 * domain means a silent logged-out boot, so `auth.setup.ts` asserts it.
 */
export const EXPECTED_COOKIE_DOMAIN = '.classlite.localhost'

/**
 * CredentialsEntry is one raw login input the harness POSTs to
 * `/api/auth/login`. It mirrors the backend `seed.CredentialsEntry` emitted
 * into `tests/e2e/.auth/credentials.json` (camelCase for the TS consumer).
 */
export interface CredentialsEntry {
  role: string
  email: string
  password: string
  centerShortCode: string
  centerId: string
}

/** StorageState is Playwright's persisted cookie/origin jar shape. */
export type StorageState = Awaited<ReturnType<APIRequestContext['storageState']>>

/** CapturedSession is the result of a real login: the jar + the proven cookie. */
export interface CapturedSession {
  storageState: StorageState
  refreshCookie: StorageState['cookies'][number]
}

/** CREDENTIALS_MANIFEST_PATH is the seed-emitted manifest, relative to this module. */
export const CREDENTIALS_MANIFEST_PATH = resolve(
  moduleDir,
  '../.auth/credentials.json',
)

/**
 * credentialsManifestExists reports whether the seed has emitted the manifest.
 * The manifest is a DB-dependent, gitignored seed OUTPUT (DD3): it is present
 * in a seeded local/E2E environment and absent in the web unit-CI (no DB). The
 * data-contract test uses this to skip-with-reason when absent while the
 * pure-logic WF-8 guards always run.
 */
export function credentialsManifestExists(): boolean {
  return existsSync(CREDENTIALS_MANIFEST_PATH)
}

/**
 * loadCredentials reads and returns the seeded login manifest. It throws a
 * directive error if the file is missing — the only reason it would be is that
 * the seed has not run, which is a hard precondition (not a silent empty set).
 */
export function loadCredentials(): CredentialsEntry[] {
  let raw: string
  try {
    raw = readFileSync(CREDENTIALS_MANIFEST_PATH, 'utf8')
  } catch {
    throw new Error(
      `credentials manifest not found at ${CREDENTIALS_MANIFEST_PATH}. Run the seed ` +
        `(classlite-api: scripts/seed.sh) so it emits tests/e2e/.auth/credentials.json ` +
        `before the E2E auth setup.`,
    )
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(
      `credentials manifest at ${CREDENTIALS_MANIFEST_PATH} is not valid JSON — ` +
        `it is likely truncated or corrupt. Re-run the seed (classlite-api: ` +
        `scripts/seed.sh) to regenerate it.`,
      { cause },
    )
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      `credentials manifest at ${CREDENTIALS_MANIFEST_PATH} is not a JSON array`,
    )
  }
  return parsed as CredentialsEntry[]
}

/**
 * The development/staging host allowlist. The real R-11-3 proof is structural
 * (harness unreachable from the bundle); this allowlist is a tripwire so a
 * real login can never be aimed at a production URL. "Production" is this
 * negated allowlist — a concrete predicate, not an invented flag.
 */
const ALLOWED_HOST_BASES = ['classlite.localhost', 'classlite.app-staging']

function hostIsDevelopment(hostname: string): boolean {
  if (hostname === 'localhost') return true
  for (const base of ALLOWED_HOST_BASES) {
    if (hostname === base || hostname.endsWith(`.${base}`)) return true
  }
  return false
}

/**
 * guardNotProduction throws unless the target host is in the dev/staging
 * allowlist `{localhost, *.classlite.localhost, *.classlite.app-staging}`. The
 * PAIR that proves it is real (not a throw-stub): a production-shaped target
 * throws AND a development target proceeds.
 *
 * @param config the Playwright config/use block carrying the resolved baseURL.
 */
export function guardNotProduction(config: { baseURL?: string }): void {
  const { baseURL } = config
  if (!baseURL) {
    throw new Error(
      'guardNotProduction: no baseURL resolved — refusing to run a real login against an unknown target',
    )
  }
  let hostname: string
  try {
    hostname = new URL(baseURL).hostname
  } catch {
    throw new Error(`guardNotProduction: baseURL is not a valid URL: ${baseURL}`)
  }
  if (!hostIsDevelopment(hostname)) {
    throw new Error(
      `guardNotProduction: refusing to run the real-login harness against a ` +
        `production-shaped target (${hostname}). Allowed: localhost, ` +
        `*.classlite.localhost, *.classlite.app-staging.`,
    )
  }
}

/**
 * loginAndCaptureSession performs a REAL `POST /api/auth/login`, asserts a 200
 * AND that the cookie jar actually gained a `refresh_token`, then returns the
 * captured storageState and the proven cookie. There is no fabrication branch:
 * a non-2xx or a cookieless jar throws loudly rather than persist a dead
 * session (the exact three-month failure mode this story defends against).
 *
 * @param request a fresh Playwright APIRequestContext scoped to the dev baseURL.
 * @param cred the seeded identity to authenticate.
 */
export async function loginAndCaptureSession(
  request: APIRequestContext,
  cred: CredentialsEntry,
  options?: { origin?: string },
): Promise<CapturedSession> {
  // The server's OriginCheck rejects state-changing POSTs whose Origin is not
  // allow-listed — AND rejects an absent Origin. A Playwright APIRequestContext
  // does not send Origin automatically (it is not a browser), so we set it
  // explicitly to the dev host origin. The API's CORS_ORIGINS must include that
  // origin (see tests/e2e/README.md preconditions).
  const headers = options?.origin ? { Origin: options.origin } : undefined
  const response = await request.post('/api/auth/login', {
    data: { email: cred.email, password: cred.password, rememberMe: true },
    headers,
  })
  if (!response.ok()) {
    let detail = ''
    try {
      detail = await response.text()
    } catch {
      /* body already consumed / unavailable — status is enough */
    }
    throw new Error(
      `login failed for ${cred.email}: HTTP ${response.status()} ${detail}`.trim(),
    )
  }
  const storageState = await request.storageState()
  const refreshCookie = storageState.cookies.find(
    (c) => c.name === REFRESH_COOKIE_NAME,
  )
  if (!refreshCookie) {
    throw new Error(
      `login for ${cred.email} returned 200 but no ${REFRESH_COOKIE_NAME} cookie ` +
        `was captured — refusing to persist a cookieless (silently logged-out) session`,
    )
  }
  return { storageState, refreshCookie }
}

/**
 * reauthenticate re-runs a real login for recovery after a rotated/revoked
 * refresh token (AC4). It returns a fresh storageState; the CALLER must
 * re-create its browser context from it — rewriting the session file does not
 * heal an already-loaded context.
 *
 * @param request a fresh Playwright APIRequestContext scoped to the dev baseURL.
 * @param cred the seeded identity to re-authenticate.
 */
export async function reauthenticate(
  request: APIRequestContext,
  cred: CredentialsEntry,
  options?: { origin?: string },
): Promise<CapturedSession> {
  return loginAndCaptureSession(request, cred, options)
}

/**
 * originOf extracts the scheme+host+port origin from a baseURL, for the Origin
 * header the harness login must send (the server's OriginCheck requires it).
 *
 * @param baseURL the Playwright-resolved base URL (may be undefined).
 */
export function originOf(baseURL: string | undefined): string | undefined {
  if (!baseURL) return undefined
  try {
    return new URL(baseURL).origin
  } catch {
    return undefined
  }
}

/**
 * sessionFileFor returns the per-identity storageState path. One file per
 * consuming context (D2): a persisted `refresh_token` is single-use against a
 * rotating server, so no shared rotating default is permitted. The slug is
 * derived from the center + email local-part so `teacher` and `teacher2` (same
 * role, same center) never collide.
 *
 * @param cred the seeded identity.
 */
export function sessionFileFor(cred: CredentialsEntry): string {
  return `.playwright/${sessionSlug(cred.centerShortCode, cred.email)}.json`
}

/**
 * sessionSlug is the pure path-slug builder behind `sessionFileFor`. It is
 * exported so `playwright.config.ts` can compute a storageState path from
 * literal seed values WITHOUT reading the (possibly-absent) credentials
 * manifest at config-eval time.
 *
 * @param centerShortCode the tenant short code (e.g. `SEEDFAKEA`).
 * @param email the identity's email; its local-part disambiguates same-role peers.
 */
export function sessionSlug(centerShortCode: string, email: string): string {
  const idSlug = email.split('@')[0].replace(/[^a-z0-9]+/gi, '-')
  return `${centerShortCode}-${idSlug}`
}
