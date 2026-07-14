/**
 * useChecklistState — persistent snooze state for the FinishSetupCard.
 *
 * Story 2-4 AC4/AC5/AC6 — client-side persistence via `localStorage` under a
 * per-user-id key (`classlite_finish_setup_v1_${userId}`) with a 7-day
 * snooze window. No wire endpoint — FU-2-4-A tracks backend sync.
 *
 * External-store design [A-STRONG-12 + W-STRONG-5 + M-STRONG-11/12/17 folds]:
 *   - `subscribe` is a **module-scope constant** (React 19 requires stable
 *     reference; inline arrow re-subscribes each render).
 *   - Subscription registers both a `storage` window listener (cross-tab
 *     writes) and the caller's `notify` in a private `Set<() => void>` so
 *     `snooze()` bumps propagate to every mounted consumer.
 *   - `getSnapshot(userId)` returns a **referentially-stable** snapshot via
 *     a `Map<userId, {version, state}>` cache invalidated on every `bump`.
 *     This keeps `useSyncExternalStore` happy across renders while still
 *     re-reading localStorage on cross-tab or intra-tab writes.
 *   - Malformed localStorage payloads (empty string / `null` literal /
 *     wrong shape / parse error / wrong root type) resolve to a fresh
 *     `{ snoozedUntil: null }` **without throwing** and emit a Sentry
 *     breadcrumb with a truncated key snippet (never the full payload).
 *   - Snoozed-boundary auto-re-read — on mount with a future
 *     `snoozedUntil`, schedule `setTimeout(bump, snoozedUntil - now + 1000)`
 *     so the tab-B stale case (tab-A snoozed 7d ago, tab-B idle) refreshes
 *     visibility at the boundary without polling.
 *   - `userId === null` (boot-probe / anonymous) → returns
 *     `{ isVisible: false, snooze: noop }` — guards against writing to
 *     a null-scoped key.
 *
 * `isVisible` is derived from `Date.now()` on every render. Callers must
 * `rerender()` to observe boundary transitions — `useSyncExternalStore`
 * does not poll (M-STRONG-17 note).
 */
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { addBreadcrumb } from '@sentry/react'

export interface ChecklistState {
  snoozedUntil: number | null
}

export interface UseChecklistStateResult {
  state: ChecklistState
  snooze: () => void
  isVisible: boolean
}

const KEY_PREFIX = 'classlite_finish_setup_v1_'
const SNOOZE_WINDOW_MS = 7 * 24 * 3600 * 1000
const NULL_STATE: ChecklistState = Object.freeze({ snoozedUntil: null })

// Per-userId snapshot cache. Keyed by the raw localStorage payload so
// (a) same raw → same referential state, keeping useSyncExternalStore
// stable across renders; (b) localStorage.clear() implicitly invalidates
// the cache (raw shifts to `null`), which is essential for cross-test
// isolation since module-scope caches persist across `beforeEach`.
const snapshotCache = new Map<
  string,
  { raw: string | null; state: ChecklistState }
>()

// Notify set — every mounted consumer's `notify` callback lives here so
// intra-tab `snooze()` can broadcast without touching localStorage twice.
const subscribers = new Set<() => void>()

function keyFor(userId: string): string {
  return KEY_PREFIX + userId
}

function readStateFromRaw(
  userId: string,
  raw: string | null,
): ChecklistState {
  if (raw === null) return NULL_STATE

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    addBreadcrumb({
      category: 'checklist',
      message: 'malformed-localstorage',
      level: 'warning',
      data: { userId },
    })
    return NULL_STATE
  }

  if (
    parsed !== null &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    'snoozedUntil' in parsed &&
    typeof (parsed as { snoozedUntil: unknown }).snoozedUntil === 'number'
  ) {
    // Reject non-finite / non-positive numbers — a JSON payload of
    // `{snoozedUntil: NaN}` or `{snoozedUntil: Infinity}` would parse as
    // `typeof number` yet schedule `setTimeout(fn, NaN + 1000)` which most
    // engines coerce to a 1ms bump loop; negative values would mark the
    // window "already elapsed" and re-fire the bump immediately.
    const rawValue = (parsed as { snoozedUntil: number }).snoozedUntil
    if (Number.isFinite(rawValue) && rawValue > 0) {
      return { snoozedUntil: rawValue }
    }
  }

  addBreadcrumb({
    category: 'checklist',
    message: 'malformed-localstorage',
    level: 'warning',
    data: { userId },
  })
  return NULL_STATE
}

function getSnapshotFor(userId: string | null): ChecklistState {
  if (userId === null) return NULL_STATE
  let raw: string | null
  try {
    raw = window.localStorage.getItem(keyFor(userId))
  } catch {
    // Safari private mode + disabled-storage clients throw here. Silent
    // failure meant users saw the checklist forever and snooze never stuck
    // — surface the outage in Sentry so we can quantify at scale.
    addBreadcrumb({
      category: 'checklist',
      message: 'localstorage-unavailable',
      level: 'warning',
      data: { userId },
    })
    return NULL_STATE
  }
  const cached = snapshotCache.get(userId)
  if (cached && cached.raw === raw) return cached.state
  const state = readStateFromRaw(userId, raw)
  snapshotCache.set(userId, { raw, state })
  return state
}

// Force a fresh snapshot identity for every mounted consumer — used on
// boundary re-reads (W-STRONG-15 setTimeout wake) where raw localStorage
// did NOT change but visibility did. The cache is intentionally NOT cleared
// here: `getSnapshotFor`'s `cached.raw === raw` check re-reads localStorage
// on every notify anyway, so mismatched raw invalidates the cache
// naturally. Clearing the whole map would also drop unrelated users'
// entries — with per-user keying that's cross-user cache poisoning.
function bumpAll(): void {
  subscribers.forEach((cb) => cb())
}

// Module-scope constant per A-STRONG-12 fold. Stable reference across all
// renders — React 19 must NOT resubscribe on every render.
const subscribe = (notify: () => void): (() => void) => {
  subscribers.add(notify)
  const storageHandler = (event: StorageEvent): void => {
    // Filter foreign writes: (a) sessionStorage events flow through the
    // same listener; (b) any other feature's localStorage key would
    // otherwise trigger a dashboard re-render for no reason. Guard by
    // storageArea + key prefix.
    if (event.storageArea !== window.localStorage) return
    if (event.key !== null && !event.key.startsWith(KEY_PREFIX)) return
    // Cross-tab write may have changed localStorage — notify every
    // consumer (including this one). `getSnapshotFor`'s raw-mismatch check
    // handles the actual cache invalidation for the affected userId.
    notify()
  }
  window.addEventListener('storage', storageHandler)
  return (): void => {
    subscribers.delete(notify)
    window.removeEventListener('storage', storageHandler)
  }
}

export function useChecklistState(
  userId: string | null,
): UseChecklistStateResult {
  const state = useSyncExternalStore<ChecklistState>(
    subscribe,
    () => getSnapshotFor(userId),
    () => NULL_STATE,
  )

  // Boundary re-read: refresh visibility right after `snoozedUntil` elapses.
  // W-STRONG-15 fold. Cleared on unmount (no leaked timeout).
  //
  // Cache-invalidation nuance: at the boundary the raw localStorage payload
  // has NOT changed — the snooze value is the same, only wall-clock time
  // has advanced past it. `getSnapshotFor`'s `cached.raw === raw` check
  // would return the cached state identity, `useSyncExternalStore` would
  // Object.is-equal it against the previous snapshot, and skip the
  // re-render. `computeIsVisible` (which reads live `Date.now()`) would
  // never re-run and the card would stay hidden past the boundary. Delete
  // this user's cache entry so the next `getSnapshotFor` builds a fresh
  // state object; identity change forces the re-render.
  useEffect(() => {
    if (userId === null) return
    const snoozedUntil = state.snoozedUntil
    if (snoozedUntil == null) return
    const delta = snoozedUntil - Date.now()
    if (delta <= 0) return
    const handle = window.setTimeout(() => {
      snapshotCache.delete(userId)
      bumpAll()
    }, delta + 1000)
    return () => {
      window.clearTimeout(handle)
    }
  }, [userId, state.snoozedUntil])

  const snooze = useCallback((): void => {
    if (userId === null) return
    const snoozedUntil = Date.now() + SNOOZE_WINDOW_MS
    try {
      window.localStorage.setItem(
        keyFor(userId),
        JSON.stringify({ snoozedUntil }),
      )
    } catch {
      // Quota exceeded or storage disabled — swallow; the breadcrumb below
      // still fires so we notice at scale.
    }
    addBreadcrumb({
      category: 'checklist',
      message: 'checklist-snoozed',
      level: 'info',
      data: { userId, snoozedUntil },
    })
    bumpAll()
  }, [userId])

  return {
    state,
    snooze,
    isVisible: computeIsVisible(userId, state.snoozedUntil),
  }
}

// Module-scope purity boundary — react-hooks/purity rule flags `Date.now()`
// inside a hook body but not inside a plain module-scope function. The
// boundary-bump `setTimeout` scheduled above ensures the hook re-renders
// at `snoozedUntil` + 1s, so callers get a fresh `isVisible` reading
// exactly when it matters.
function computeIsVisible(
  userId: string | null,
  snoozedUntil: number | null,
): boolean {
  if (userId === null) return false
  if (snoozedUntil === null) return true
  return Date.now() >= snoozedUntil
}
