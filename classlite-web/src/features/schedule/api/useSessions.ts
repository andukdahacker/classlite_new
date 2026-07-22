/**
 * useSessions / useClassSessions / useSession — Story 3.4 read hooks. The page
 * owns the query (FW-1); components receive `sessions` as props. Envelope is
 * unwrapped by apiFetch (TS-4). Dates stay ISO on the wire (TS-6).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { sessionsKeys } from './sessionsKeys'

export type SessionWire = components['schemas']['Session']
export type SessionDetailWire = components['schemas']['SessionDetail']
export type RecurrencePatternWire = components['schemas']['RecurrencePattern']
export type ApplyScope = components['schemas']['ApplyScope']

const STALE_TIME_MS = 30 * 1000

export interface SessionRange {
  from: string
  to: string
  classId?: string | null
}

function rangePath({ from, to, classId }: SessionRange): string {
  const params = new URLSearchParams({ from, to })
  if (classId) params.set('classId', classId)
  return `/api/sessions?${params.toString()}`
}

/** The calendar grid list for the visible window. */
export function useSessions(range: SessionRange, enabled = true) {
  return useQuery({
    queryKey: sessionsKeys.range(range.from, range.to, range.classId),
    queryFn: () => apiFetch<SessionWire[]>(rangePath(range)),
    enabled,
    staleTime: STALE_TIME_MS,
  })
}

/** The class-detail Sessions tab list. */
export function useClassSessions(classId: string, from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: sessionsKeys.byClass(classId, from, to),
    queryFn: () => apiFetch<SessionWire[]>(rangePath({ from, to, classId })),
    enabled: enabled && Boolean(classId),
    staleTime: STALE_TIME_MS,
  })
}

/** A single session + its series counts (the scope-confirm oracle). */
export function useSession(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? sessionsKeys.detail(id) : sessionsKeys.details(),
    queryFn: () => apiFetch<SessionDetailWire>(`/api/sessions/${id}`),
    enabled: Boolean(id),
    staleTime: STALE_TIME_MS,
  })
}
