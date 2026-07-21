/**
 * useCenterId — reads the active center id from the module-singleton session
 * cache (the SAME source `useRole()` reads), via stable module-level
 * subscribe/snapshot fns so useSyncExternalStore never re-subscribes to the
 * whole QueryCache per render (the CR-2-6 P1 footgun). Extracted so the Story
 * 3.3 template surfaces share the ClassesPage pattern without duplicating it.
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

export function useSessionSnapshot(): Session | null {
  return useSyncExternalStore<Session | null>(
    subscribeToSessionCache,
    getSessionSnapshot,
    getSessionServerSnapshot,
  )
}

export function useCenterId(): string | null {
  return useSessionSnapshot()?.center?.id ?? null
}
