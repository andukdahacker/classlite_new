/**
 * useAuth — app-wide auth state, subscribing to the TanStack Query cache.
 *
 * Cache-only subscription pattern (FW-6, R38-adjacent — cache writes are
 * the canonical authentication signal, not module-level Zustand). The
 * session is hydrated on first mount via:
 *
 *   1. The boot-time refresh probe in `App.tsx` (Task 15) — calls
 *      `runBootProbe()` if the cache is empty, populating it on success.
 *   2. A `useLogin` / `useRegister` mutation — populates the cache on
 *      success.
 *   3. The 401 silent-refresh path through `apiFetch` → `auth-refresh.ts`
 *      — populates the cache after recovering from an expired access
 *      token.
 *
 * All three paths converge on the same `['auth', 'session']` cache key.
 *
 * Implementation — two `useSyncExternalStore` subscriptions:
 *   - `session` reads the cache via `QueryCache.subscribe(...)` so any
 *     consumer re-renders on a `setQueryData` write regardless of which
 *     tree fired the mutation.
 *   - `isLoading` reads the boot-probe in-flight flag from
 *     `auth-refresh.ts` so future route guards (Story 2.6) can wait for
 *     the probe to resolve before deciding the user is logged out (D2
 *     amendment 2026-06-25 — without this, a returning user with a valid
 *     refresh cookie would get bounced to /login mid-probe).
 *
 * `isAuthenticated` is derived from `user.emailVerified`, NOT from the
 * presence of `accessToken`. A registered-but-unverified user has
 * `{user, accessToken: null}` in cache — Story 1.9a verify-email screen
 * reads `useAuth().user.fullName` to render "We sent a code to
 * {{email}}" without leaking authenticated UI elsewhere. See
 * `authKeys.ts` Session JSDoc for the contract.
 */
import { useMemo, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import {
  getBootProbeInFlight,
  subscribeBootProbe,
} from '@/lib/auth-refresh'

export interface User {
  id: string
  email: string
  displayName: string
  emailVerified: boolean
}

export interface UseAuthResult {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  /**
   * Raw session cache entry. Exposed for AC8 route guards + `useCurrentCenter`
   * which need `session.center` and `session.accessToken` (Story 2-3a AC8/AC9).
   * Prefer the derived `user` / `isAuthenticated` for UI logic; reach for
   * `session` only when the raw cache shape matters.
   */
  session: Session | null
}

const SESSION_KEY_TUPLE = authKeys.session()

export function useAuth(): UseAuthResult {
  const queryClient = useQueryClient()
  const session = useSyncExternalStore<Session | null>(
    (notify) => {
      const cache = queryClient.getQueryCache()
      const unsubscribe = cache.subscribe(() => notify())
      return unsubscribe
    },
    () =>
      (queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) as
        | Session
        | undefined) ?? null,
    // Server snapshot — keeps SSR safe (currently unused since the
    // dashboard is SPA, but cheap to include).
    () => null,
  )
  const isLoading = useSyncExternalStore<boolean>(
    subscribeBootProbe,
    getBootProbeInFlight,
    () => false,
  )
  // Memoize `user` on its PRIMITIVE fields so its identity is stable across
  // renders that don't change the session. `useAuth` subscribes to the whole
  // query cache, so ANY `setQueryData` anywhere (e.g. the onboarding auto-save
  // PUT writing its progress cache) re-renders every consumer. Rebuilding a
  // fresh `user` object each render made `user` an unstable dependency —
  // effects/memos keyed on `user` re-ran on every unrelated cache write. On
  // the onboarding pages that alone drove a self-perpetuating ~1.5s auto-save
  // loop (PUT → cache write → re-render → new `user` → effect refires → PUT).
  // Keying the memo on the raw fields (not the `session` object) also survives
  // structural-sharing churn that hands back a new session reference with
  // identical contents.
  const uid = session?.user?.id ?? null
  const uemail = session?.user?.email ?? null
  const uname = session?.user?.fullName ?? null
  const uverified = session?.user?.emailVerified ?? null
  const user: User | null = useMemo(
    () =>
      uid !== null
        ? {
            id: uid,
            email: uemail as string,
            // Wire shape uses `fullName`; UI shape uses `displayName` so
            // downstream consumers (UserPill, RegisterPage success copy, etc.)
            // can rename without re-validating the openapi schema. Same value;
            // different label boundary.
            displayName: uname as string,
            emailVerified: uverified as boolean,
          }
        : null,
    [uid, uemail, uname, uverified],
  )
  return {
    user,
    // Authentication = user present AND email verified. accessToken
    // presence stays in the cache for logout/probe paths but is NOT the
    // gate — see authKeys.ts Session JSDoc.
    isAuthenticated: user?.emailVerified === true,
    isLoading,
    session,
  }
}
