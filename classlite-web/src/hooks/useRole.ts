/**
 * useRole — the current user's role for the active center.
 *
 * Story 2.6 graduates this hook from the null-stub Story 1-7c shipped.
 * Resolution order:
 *   1. `RoleContext` (Storybook decorator + component-test seam) — if a
 *      caller supplies an explicit override, that wins so a story can
 *      render "Teacher view" against a mocked session cache without
 *      wrangling the authKeys.session() entry.
 *   2. `Session.role` from the authKeys.session() cache (Story 2.6 AC2).
 *   3. `null` — unauthenticated, or session hasn't hydrated the role yet
 *      (see `useRoleLoading` for the "loading vs unauthenticated"
 *      distinguisher).
 *
 * Implementation note — we subscribe against the module-singleton
 * `queryClient` (imported from `@/lib/query-client`) via
 * `useSyncExternalStore` rather than going through `useAuth()`. That
 * keeps the hook usable in the AppLayout render even when the caller
 * hasn't wired a `<QueryClientProvider>` around the tree (Storybook
 * decorators + a subset of shipped component tests seed the
 * RoleContext without one). The runtime cache is the same singleton the
 * production `<QueryClientProvider>` binds.
 *
 * The role enum matches the DB CHECK constraint at
 * `20260717120000_add_role_check_center_members`: Owner > Admin > Teacher;
 * Student is a separate consumer role.
 */
import { useContext, useSyncExternalStore } from 'react'
import { RoleContext } from '@/hooks/RoleContext'
import { queryClient } from '@/lib/query-client'
import {
  getBootProbeInFlight,
  subscribeBootProbe,
} from '@/lib/auth-refresh'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'

// Re-export so shipped call sites `import type { Role } from '@/hooks/useRole'`
// keep working without a rename sweep.
export type { Role }

const SESSION_KEY_TUPLE = authKeys.session()

// Stable module-level store fns — a new `subscribe` identity each render
// makes useSyncExternalStore tear down + re-subscribe to the QueryCache on
// EVERY render of useRole/useSessionCacheEntry (AppLayout + every route
// gate). Hoisting keeps the subscription identity constant, mirroring the
// module-level `subscribeBootProbe`. The subscription is intentionally
// broad (all cache events), but `getSessionCacheSnapshot` returns the same
// object reference until the session entry changes, so useSyncExternalStore
// bails out of re-render on unrelated query activity.
function subscribeSessionCache(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(() => notify())
}

function getSessionCacheSnapshot(): Session | null {
  return (
    (queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) as
      | Session
      | undefined) ?? null
  )
}

function getSessionCacheServerSnapshot(): Session | null {
  return null
}

function useSessionCacheEntry(): Session | null {
  return useSyncExternalStore<Session | null>(
    subscribeSessionCache,
    getSessionCacheSnapshot,
    getSessionCacheServerSnapshot,
  )
}

export function useRole(): Role | null {
  const override = useContext(RoleContext)
  const session = useSessionCacheEntry()
  // RoleContext default is null; a real override is any non-null value.
  // The `null` provider (Storybook toolbar's "no override" slot) still
  // yields null here, which is exactly what we want — fall through to
  // the session cache.
  if (override !== null) return override
  return session?.role ?? null
}

/**
 * useRoleLoading — distinguishes "boot probe in flight" and the
 * "session hydrated but role hasn't landed yet" deploy-migration window
 * from "role is genuinely null because the user is unauthenticated."
 *
 * The `RouteRoleGate` reads this to decide between rendering the loading
 * fallback (spinner / skeleton) and rendering `PermissionDenied` — the
 * boot-probe case must NEVER render `PermissionDenied`, and the
 * hydrating-role case must NEVER either (else the pre-2.6 session cache
 * entries flash a denial screen mid-refresh).
 *
 * Second-clause justification: `session != null && session.role == null
 * && session.center != null` catches a returning user whose cache entry
 * predates the Story 2.6 role wire-through — they have a center
 * membership (so are onboarded) but no cached role. The next silent
 * refresh (extended in Story 2.6 to include `role`) fills the field and
 * this hook flips to `false`. Post-migration-window this clause becomes
 * dead code; keeping it in as a belt costs nothing and closes CR-2-5A-7.
 */
export function useRoleLoading(): boolean {
  const isLoading = useSyncExternalStore<boolean>(
    subscribeBootProbe,
    getBootProbeInFlight,
    () => false,
  )
  const session = useSessionCacheEntry()
  if (isLoading) return true
  if (session != null && session.role == null && session.center != null) {
    return true
  }
  return false
}
