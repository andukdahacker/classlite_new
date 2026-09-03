/**
 * useStaffSession / useStaffCenterId — read the active center id from the
 * module-singleton session cache (the SAME source `useRole()` reads), via stable
 * module-level subscribe/snapshot fns so `useSyncExternalStore` never
 * re-subscribes to the whole QueryCache per render (the CR-2-6 P1 footgun).
 *
 * Mirrors `features/classes/lib/useCenterId.ts` rather than importing it — the
 * FW-7 feature boundary forbids reaching into another feature's internals, and
 * the shared `useCurrentCenter` hook reads the PROVIDER client (via
 * `useQueryClient`), which in component tests is a fresh empty client while the
 * session is seeded on the singleton. Reading the singleton directly is what
 * makes the invite modal + Owner-action picker see the seeded center in tests.
 */
import { useSyncExternalStore } from 'react'
import { queryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'

const SESSION_KEY_TUPLE = authKeys.session()

function subscribeToSessionCache(notify: () => void): () => void {
  return queryClient.getQueryCache().subscribe(notify)
}
function getSessionSnapshot(): Session | null {
  return queryClient.getQueryData<Session>(SESSION_KEY_TUPLE) ?? null
}
function getSessionServerSnapshot(): Session | null {
  return null
}

export function useStaffSession(): Session | null {
  return useSyncExternalStore<Session | null>(
    subscribeToSessionCache,
    getSessionSnapshot,
    getSessionServerSnapshot,
  )
}

export function useStaffCenterId(): string | null {
  return useStaffSession()?.center?.id ?? null
}
