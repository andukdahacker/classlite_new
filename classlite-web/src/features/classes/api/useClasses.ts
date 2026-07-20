/**
 * useClasses — Story 3.1 role-scoped class list (AC5).
 *
 * The server branches GET /api/classes on the DB-authoritative tc.Role
 * (owner/admin = all center classes; teacher = own only). The client passes a
 * `scope` so owner and teacher payloads occupy distinct cache entries.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { classesKeys, type ClassListScope } from './classesKeys'

export type ClassWire = components['schemas']['Class']
export type ClassStatus = components['schemas']['ClassStatus']

const STALE_TIME_MS = 60 * 1000

export function useClasses(
  centerId: string | null | undefined,
  scope: ClassListScope,
) {
  return useQuery({
    queryKey: centerId
      ? classesKeys.list(centerId, scope)
      : classesKeys.listDisabled(),
    queryFn: () => apiFetch<ClassWire[]>('/api/classes'),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}
