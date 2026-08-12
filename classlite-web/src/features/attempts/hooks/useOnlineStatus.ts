/**
 * useOnlineStatus — Story 5.3 Task 3 (AC12, Winston BLOCKER 1). Tracks browser
 * connectivity via `navigator.onLine` + the `window` `online`/`offline` events,
 * as a `useSyncExternalStore` (the React 19 external-store idiom — no `useEffect`
 * data-fetch). Greenfield: no such hook existed before 5.3.
 *
 * The writing attempt uses this to (a) pause autosave + surface the "Offline —
 * changes saved on this device" reassurance while offline, and (b) drive the LIVE
 * reconnect handler on the `online` transition (the net-new resume-flush path,
 * AC12). jsdom-safe: `navigator.onLine` defaults to `true` and the events are
 * dispatchable, so the offline→reconnect BLOCKER test drives it without mocking
 * the hook (Murat F4 — forbids `vi.mock('useOnlineStatus')`).
 */
import { useCallback, useSyncExternalStore } from 'react'

function subscribe(notify: () => void): () => void {
  window.addEventListener('online', notify)
  window.addEventListener('offline', notify)
  return () => {
    window.removeEventListener('online', notify)
    window.removeEventListener('offline', notify)
  }
}

/**
 * @returns `true` when the browser reports it is online. SSR / pre-hydration
 *   defaults to `true` (assume online until told otherwise).
 */
export function useOnlineStatus(): boolean {
  const getSnapshot = useCallback(() => navigator.onLine, [])
  return useSyncExternalStore(subscribe, getSnapshot, () => true)
}
