/**
 * Auth refresh coordinator — single source of truth for `/api/auth/refresh`.
 *
 * Closes UX-DR19 and the "concurrent-query refresh stampede" risk in one
 * module. Three coalescing layers stack:
 *
 *   1. Module-singleton `refreshPromise` — coalesces concurrent in-process
 *      callers BEFORE the lock. N parallel apiFetch 401s in this tab fire
 *      a single network refresh, not N.
 *
 *   2. `navigator.locks.request(LOCK_NAME, ...)` — coalesces ACROSS tabs.
 *      Without this layer, two tabs both 401, both refresh, the second
 *      uses the refresh-token the first just rotated, the server detects
 *      reuse and revokes the user's token family. The lock serializes
 *      the network refresh across every tab of this origin.
 *
 *   3. `lastRefreshedAt` debounce — the lock alone is NOT sufficient.
 *      Tab 1 acquires the lock, refreshes, releases. Tab 2 was blocked
 *      on the lock; on acquire it would HAPPILY post a second refresh —
 *      burning the rotation Tab 1 just performed. The debounce is
 *      persisted to `localStorage` (synchronously visible to every
 *      same-origin tab) so the check inside the lock callback truly
 *      sees Tab 1's completed timestamp before Tab 2 enters its body.
 *
 * A `BroadcastChannel('classlite_auth')` carries the outcome to sibling
 * tabs: `refresh-succeeded` updates `lastRefreshedAt` AND hydrates the
 * `['auth', 'session']` cache via `setQueryData` (NOT
 * `invalidateQueries` — the queryFn returns `null` so an invalidate
 * would clobber the just-written session). `refresh-failed` triggers
 * the same `onAuthFailure` redirect every tab.
 *
 * Story 1-8 refactor (Winston #1 + Amelia #1): `performNetworkRefresh`
 * now parses the `EnvelopeLoginResult` body so the success path hydrates
 * `useAuth` directly (no second protected request needed to populate the
 * cache). `RefreshResult` carries `data` on success. Cache writes use
 * the LITERAL `['auth', 'session']` key array because importing
 * `authKeys.session()` would land a third edge on the existing
 * query-client ↔ api-fetch import cycle. The duplicated literal is
 * locked by `authKeys.test.ts`'s contract assertion.
 *
 * Module-load order forms a cycle with api-fetch.ts and query-client.ts;
 * the cross-references resolve inside callbacks (not at top level), which
 * ES modules tolerate safely.
 */
import * as Sentry from '@sentry/react'
import { queryClient } from './query-client'
import { AuthExpiredError } from './api-fetch'
import type { components } from '@/lib/api/client'

type EnvelopeLoginResult = components['schemas']['EnvelopeLoginResult']
type UserSummary = components['schemas']['UserSummary']

const CHANNEL_NAME = 'classlite_auth'
const LOCK_NAME = 'classlite_token_refresh'
const LAST_REFRESHED_STORAGE_KEY = 'classlite_last_refreshed_at'
const REFRESH_DEBOUNCE_MS = 5_000
const SESSION_EXPIRED_PATH = '/login?session_expired=1'
// Literal `['auth', 'session']` — duplicates `authKeys.session()` from
// `src/features/auth/api/authKeys.ts`. See JSDoc above for the cycle
// rationale; the contract test `authKeys.test.ts` locks the literal.
const SESSION_QUERY_KEY = ['auth', 'session'] as const

export interface RefreshSessionData {
  user: UserSummary
  accessToken: string
}

export type RefreshResult =
  | { ok: true; data: RefreshSessionData | null }
  | { ok: false }

interface RefreshSucceededSignal {
  type: 'refresh-succeeded'
  timestamp: number
  // Sibling tabs use the payload to hydrate their own caches without a
  // second network round trip. `null` indicates a debounce-hit or
  // malformed-body success path (see performNetworkRefresh).
  data: RefreshSessionData | null
}

interface RefreshFailedSignal {
  type: 'refresh-failed'
}

/**
 * Story 1-9a Layer B amendment (party-mode 2026-06-25). Sibling tabs
 * holding /verify-email pollers need to learn that THIS tab just logged
 * in, so their cached `useAuth().isAuthenticated` flips to `true` and
 * the LoginPage's Layer-A already-auth guard redirects them away. Same
 * BroadcastChannel + same hydration helper as `refresh-succeeded` — the
 * payload is non-nullable because a successful login always carries a
 * fresh session (unlike refresh, which can debounce-hit to `null`).
 */
interface LoginSucceededSignal {
  type: 'login-succeeded'
  timestamp: number
  data: RefreshSessionData
}

type RefreshSignal =
  | RefreshSucceededSignal
  | RefreshFailedSignal
  | LoginSucceededSignal

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(CHANNEL_NAME)
    : null

let refreshPromise: Promise<RefreshResult> | null = null

// Boot-probe state (code-review D2 2026-06-25).
//
// `useAuth().isLoading` must reflect "boot refresh in flight" so a future
// router guard (`if (!isAuthenticated && !isLoading) navigate('/login')`)
// can wait for the probe to resolve before deciding the user is logged
// out. The probe is async — without this signal, a returning user with a
// valid refresh cookie gets bounced to /login BEFORE the silent-refresh
// success path hydrates the cache (the same regression Winston #4 was
// lifted to fix at the App.tsx level).
//
// Subscribers (useAuth's useSyncExternalStore) get notified on transitions
// to/from `true`. The flag does NOT change for in-tab token-refresh calls
// triggered by 401s on protected requests — only for the explicit boot
// probe wrapper below.
let bootProbeInFlight = false
const bootProbeListeners = new Set<() => void>()

function notifyBootProbeChange(): void {
  // forEach over Set is downlevel-safe across every TypeScript target
  // configuration; for-of would require `--downlevelIteration` or a
  // modern target. The defensive form keeps IDE diagnostics quiet
  // regardless of how the consumer's tsconfig is wired.
  bootProbeListeners.forEach((listener) => listener())
}

export function getBootProbeInFlight(): boolean {
  return bootProbeInFlight
}

export function subscribeBootProbe(listener: () => void): () => void {
  bootProbeListeners.add(listener)
  return () => bootProbeListeners.delete(listener)
}

/**
 * Boot-time refresh probe wrapper — sets `bootProbeInFlight = true` for
 * the duration of `refreshAccessToken()` so `useAuth().isLoading`
 * observes the in-flight state. Resolves to the same `RefreshResult` as
 * the underlying primitive; the App.tsx caller `void`s it.
 */
export async function runBootProbe(): Promise<RefreshResult> {
  bootProbeInFlight = true
  notifyBootProbeChange()
  try {
    return await refreshAccessToken()
  } finally {
    bootProbeInFlight = false
    notifyBootProbeChange()
  }
}

// Module-level idempotency latch for `onAuthFailure`. Multiple callers
// (apiFetch direct, QueryCache.onError safety net, BroadcastChannel
// listener) can converge on a single 401 event and would otherwise each
// post a Sentry breadcrumb + invoke `window.location.assign`. The latch
// fires the redirect exactly once per session; tests reset it via
// `__resetAuthRefreshStateForTests`.
let isRedirecting = false

function readLastRefreshedAt(): number {
  if (typeof window === 'undefined' || !window.localStorage) return 0
  try {
    const value = window.localStorage.getItem(LAST_REFRESHED_STORAGE_KEY)
    return value ? Number(value) : 0
  } catch {
    // Safari private mode / SecurityError — fall back to "no recent refresh"
    // which makes the next refreshAccessToken call proceed normally.
    return 0
  }
}

function writeLastRefreshedAt(timestamp: number): void {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(LAST_REFRESHED_STORAGE_KEY, String(timestamp))
  } catch {
    // QuotaExceededError / SecurityError — the debounce loses its
    // cross-tab guarantee for this session, but the in-process
    // `refreshPromise` coalesce still prevents stampedes in this tab
    // and the lock still serializes across tabs.
  }
}

function hasWebLocks(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'locks' in navigator &&
    navigator.locks !== undefined
  )
}

async function performNetworkRefresh(): Promise<RefreshResult> {
  if (Date.now() - readLastRefreshedAt() < REFRESH_DEBOUNCE_MS) {
    // Debounce hit — a sibling tab just refreshed. The cache is already
    // populated by that tab's BroadcastChannel write (or by the sibling's
    // own success path in this tab). Return ok without data; the caller
    // (apiFetch retry path) only checks `ok`.
    return { ok: true, data: null }
  }
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    if (!response.ok) {
      channel?.postMessage({
        type: 'refresh-failed',
      } satisfies RefreshFailedSignal)
      return { ok: false }
    }
    // Parse the envelope. A 200 with malformed body must NOT downgrade
    // to refresh-failed (that would log the user out on a flaky gateway).
    // Treat parse failure as refresh-succeeded-without-data — the next
    // protected request will hit 401 again and retry the refresh cleanly.
    let data: RefreshSessionData | null = null
    try {
      const envelope = (await response.json()) as EnvelopeLoginResult
      data = {
        user: envelope.data.user,
        accessToken: envelope.data.accessToken,
      }
    } catch {
      Sentry.captureMessage('auth-refresh: 200 with unparseable body', {
        level: 'warning',
      })
    }
    const stamp = Date.now()
    writeLastRefreshedAt(stamp)
    if (data) {
      // Hydrate the session cache so useAuth re-renders. Literal key —
      // see SESSION_QUERY_KEY rationale.
      queryClient.setQueryData(SESSION_QUERY_KEY, data)
    }
    channel?.postMessage({
      type: 'refresh-succeeded',
      timestamp: stamp,
      data,
    } satisfies RefreshSucceededSignal)
    return { ok: true, data }
  } catch {
    channel?.postMessage({
      type: 'refresh-failed',
    } satisfies RefreshFailedSignal)
    return { ok: false }
  }
}

async function withLockOrCoalesce(): Promise<RefreshResult> {
  if (!hasWebLocks()) {
    return performNetworkRefresh()
  }
  try {
    return await navigator.locks.request(
      LOCK_NAME,
      { mode: 'exclusive' },
      performNetworkRefresh,
    )
  } catch {
    // navigator.locks.request can reject when the page becomes hidden
    // / the lock is stolen / an AbortSignal fires. Fall back to a
    // single in-process refresh attempt rather than escaping with an
    // unhandled rejection.
    return performNetworkRefresh()
  }
}

export function refreshAccessToken(): Promise<RefreshResult> {
  if (refreshPromise) return refreshPromise

  const wrapped: Promise<RefreshResult> = (async () => {
    try {
      return await withLockOrCoalesce()
    } finally {
      refreshPromise = null
    }
  })()

  refreshPromise = wrapped
  return wrapped
}

export function onAuthFailure(error: Error): void {
  if (typeof window === 'undefined') return
  if (isRedirecting) return
  isRedirecting = true
  // Preserve the trigger error as a Sentry breadcrumb so a support
  // session can see which API path triggered the forced re-login.
  // Sentry's own functions are no-ops when init() wasn't called, so
  // tests stay clean without explicit mocking.
  Sentry.addBreadcrumb({
    category: 'auth',
    level: 'warning',
    message: 'onAuthFailure',
    data: { name: error.name, message: error.message },
  })
  // Compare pathname against literal '/login' (not the encoded
  // pathname+search) so a user already on `/login?...` doesn't get
  // an appended `next=%2Flogin%3F...` and start a self-redirect loop.
  const target =
    window.location.pathname === '/login'
      ? SESSION_EXPIRED_PATH
      : `${SESSION_EXPIRED_PATH}&next=${encodeURIComponent(
          window.location.pathname + window.location.search,
        )}`
  window.location.assign(target)
}

function isRefreshSignal(value: unknown): value is RefreshSignal {
  if (!value || typeof value !== 'object') return false
  const candidate = value as { type?: unknown; data?: unknown }
  if (candidate.type === 'refresh-failed') return true
  if (candidate.type === 'refresh-succeeded') {
    // `data` may be null on the debounce-hit path; only reject if it
    // is something other than null/object (e.g. number, string).
    return (
      candidate.data === null ||
      candidate.data === undefined ||
      (typeof candidate.data === 'object' && candidate.data !== null)
    )
  }
  if (candidate.type === 'login-succeeded') {
    // login-succeeded MUST carry a non-null session payload. Reject
    // malformed broadcasts (extension injection, stale tabs, polyfill
    // echoes) so `hydrateSessionCache(undefined)` cannot land in cache.
    if (!candidate.data || typeof candidate.data !== 'object') return false
    const data = candidate.data as { user?: unknown; accessToken?: unknown }
    return (
      typeof data.user === 'object' &&
      data.user !== null &&
      typeof data.accessToken === 'string'
    )
  }
  return false
}

function hydrateSessionCache(data: RefreshSessionData): void {
  // `invalidateQueries` would clobber (the cache key has
  // `queryFn: () => null` + `enabled: false`, so an invalidate resolves
  // to `null`). `setQueryData` skips that and writes the payload
  // straight in. Same hydration helper as the refresh-succeeded branch
  // (Story 1-9a Layer B — refactored into a helper so the two
  // listener arms can't drift apart).
  queryClient.setQueryData(SESSION_QUERY_KEY, data)
}

function handleChannelMessage(event: MessageEvent<unknown>): void {
  if (!isRefreshSignal(event.data)) return
  const msg = event.data
  if (msg.type === 'refresh-succeeded') {
    writeLastRefreshedAt(msg.timestamp)
    if (msg.data) {
      hydrateSessionCache(msg.data)
    }
  } else if (msg.type === 'login-succeeded') {
    hydrateSessionCache(msg.data)
  } else if (msg.type === 'refresh-failed') {
    onAuthFailure(new AuthExpiredError())
  }
}

/**
 * Story 1-9a Layer B — broadcast a successful login to sibling tabs.
 * Called from `useLogin.onSuccess` AFTER the local-tab cache write so
 * THIS tab is authenticated before the broadcast triggers any sibling
 * effects. Guarded by the `channel != null` capability check for Safari
 * private mode (where BroadcastChannel is undefined).
 */
export function broadcastLoginSucceeded(data: RefreshSessionData): void {
  if (!channel) return
  channel.postMessage({
    type: 'login-succeeded',
    timestamp: Date.now(),
    data,
  } satisfies LoginSucceededSignal)
}

let listenerAttached = false

function attachChannelListener(): void {
  if (listenerAttached || !channel) return
  channel.addEventListener('message', handleChannelMessage)
  listenerAttached = true
}

function detachChannelListener(): void {
  if (!listenerAttached || !channel) return
  channel.removeEventListener('message', handleChannelMessage)
  listenerAttached = false
}

attachChannelListener()

/**
 * Test-only state reset. Vitest evaluates each test file's module graph
 * once per worker, so the `refreshPromise` singleton + `isRedirecting`
 * latch bleed across tests unless explicitly cleared. The
 * `lastRefreshedAt` debounce lives in localStorage so this reset clears
 * that too. The BroadcastChannel listener is detached and re-attached
 * so any stale `refresh-*` messages queued by a prior test are dropped
 * instead of stamping the next test's state.
 */
export function __resetAuthRefreshStateForTests(): void {
  refreshPromise = null
  isRedirecting = false
  bootProbeInFlight = false
  bootProbeListeners.clear()
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(LAST_REFRESHED_STORAGE_KEY)
    } catch {
      // ignore — see writeLastRefreshedAt notes
    }
  }
  detachChannelListener()
  attachChannelListener()
}
