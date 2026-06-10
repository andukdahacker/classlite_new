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
 * tabs: `refresh-succeeded` updates `lastRefreshedAt` and invalidates the
 * Query cache so their pending queries refetch; `refresh-failed` triggers
 * the same `onAuthFailure` redirect every tab.
 *
 * Module-load order forms a cycle with api-fetch.ts and query-client.ts;
 * the cross-references resolve inside callbacks (not at top level), which
 * ES modules tolerate safely.
 */
import * as Sentry from '@sentry/react'
import { queryClient } from './query-client'
import { AuthExpiredError } from './api-fetch'

const CHANNEL_NAME = 'classlite_auth'
const LOCK_NAME = 'classlite_token_refresh'
const LAST_REFRESHED_STORAGE_KEY = 'classlite_last_refreshed_at'
const REFRESH_DEBOUNCE_MS = 5_000
const SESSION_EXPIRED_PATH = '/login?session_expired=1'

export interface RefreshResult {
  ok: boolean
}

interface RefreshSucceededSignal {
  type: 'refresh-succeeded'
  timestamp: number
}

interface RefreshFailedSignal {
  type: 'refresh-failed'
}

type RefreshSignal = RefreshSucceededSignal | RefreshFailedSignal

const channel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel(CHANNEL_NAME)
    : null

let refreshPromise: Promise<RefreshResult> | null = null

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
    return { ok: true }
  }
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    })
    if (response.ok) {
      const stamp = Date.now()
      writeLastRefreshedAt(stamp)
      channel?.postMessage({
        type: 'refresh-succeeded',
        timestamp: stamp,
      } satisfies RefreshSucceededSignal)
      return { ok: true }
    }
    channel?.postMessage({
      type: 'refresh-failed',
    } satisfies RefreshFailedSignal)
    return { ok: false }
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
  const candidate = value as { type?: unknown }
  return (
    candidate.type === 'refresh-succeeded' ||
    candidate.type === 'refresh-failed'
  )
}

function handleChannelMessage(event: MessageEvent<unknown>): void {
  if (!isRefreshSignal(event.data)) return
  const msg = event.data
  if (msg.type === 'refresh-succeeded') {
    writeLastRefreshedAt(msg.timestamp)
    void queryClient.invalidateQueries()
  } else if (msg.type === 'refresh-failed') {
    onAuthFailure(new AuthExpiredError())
  }
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
