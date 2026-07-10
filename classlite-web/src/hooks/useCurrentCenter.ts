/**
 * useCurrentCenter — the caller's center, or null before onboarding completes.
 *
 * Story 2-3a AC9 replaces the 1-7c/2-2 stub with a real selector over the
 * Session cache slot. The prior local `Center { id, name, slug }` interface
 * is deleted cleanly — `slug` is not on the new shape and a re-export would
 * not fix `.slug` reads at compile time (Amelia-B3 + Winston-W3 folds).
 * Downstream consumers migrate to `.shortCode`.
 *
 * R1-P36: reads the cache directly via `useSyncExternalStore` with a
 * center-slice snapshot, so consumers re-render ONLY on center change —
 * silent-refresh `accessToken` rotation no longer forces a re-render every
 * 15 minutes (the previous `useAuth().session?.center` subscribed to the
 * whole Session).
 */
import { useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authKeys, type CenterSummary, type Session } from '@/features/auth/api/authKeys'

const SESSION_KEY_TUPLE = authKeys.session()

export function useCurrentCenter(): CenterSummary | null {
  const queryClient = useQueryClient()
  return useSyncExternalStore<CenterSummary | null>(
    (notify) => {
      const cache = queryClient.getQueryCache()
      // Notify only when the CENTER slice changes. `useSyncExternalStore`
      // handles referential-equality dedupe, but a per-write notify is
      // still cheaper than re-rendering the world.
      let lastCenter: CenterSummary | null =
        queryClient.getQueryData<Session>(SESSION_KEY_TUPLE)?.center ?? null
      const unsubscribe = cache.subscribe(() => {
        const nextCenter =
          queryClient.getQueryData<Session>(SESSION_KEY_TUPLE)?.center ?? null
        if (nextCenter !== lastCenter) {
          lastCenter = nextCenter
          notify()
        }
      })
      return unsubscribe
    },
    () =>
      queryClient.getQueryData<Session>(SESSION_KEY_TUPLE)?.center ?? null,
    () => null,
  )
}
