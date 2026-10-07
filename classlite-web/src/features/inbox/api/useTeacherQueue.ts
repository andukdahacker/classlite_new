/**
 * useTeacherQueue — Story 10-1c (AC1/AC6). The caller's teacher grading backlog over
 * the additive `GET /api/inbox/teacher-queue` contract (a DERIVED read, NOT
 * notification rows). Uses `apiFetchWithMeta` so `meta.pagination` survives the
 * envelope unwrap (the in-feed "N to grade" count + the DD3 ceiling seam read it).
 * `lateOnly` is the SERVER-side is_late filter (Ducdo Q3 / DD6) — never a client slice,
 * so `total` stays honest. `enabled` gates the fetch to the teacher branch only (the
 * student/admin/owner views never mount it — DD5). `keepPreviousData` avoids an empty
 * flash when toggling the Late chip.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'

import type { components } from '@/lib/api/client'
import { apiFetchWithMeta } from '@/lib/api-fetch'

import { inboxKeys, type TeacherQueueParams } from './inboxKeys'

export type TeacherQueueItem = components['schemas']['TeacherQueueItem']
export type PaginationMeta = components['schemas']['PaginationMeta']
type QueueMeta = components['schemas']['EnvelopeMetaPagination']

const STALE_TIME_MS = 30 * 1000

export interface TeacherQueueResult {
  items: TeacherQueueItem[]
  pagination: PaginationMeta
  /** Server clock from the list envelope (skew-immune relative-time reference). */
  serverTime: string
}

/** Build the snake_case `GET /api/inbox/teacher-queue` query string. */
function buildQueueQuery(params: TeacherQueueParams): string {
  const search = new URLSearchParams()
  if (params.lateOnly) search.set('late_only', 'true')
  search.set('page', String(params.page))
  search.set('page_size', String(params.pageSize))
  return search.toString()
}

/** Fetch one teacher-queue page. Disabled unless `enabled` (teacher branch only). */
export function useTeacherQueue(params: TeacherQueueParams, enabled: boolean) {
  return useQuery({
    queryKey: inboxKeys.teacherQueue(params),
    queryFn: async (): Promise<TeacherQueueResult> => {
      const envelope = await apiFetchWithMeta<TeacherQueueItem[], QueueMeta>(
        `/api/inbox/teacher-queue?${buildQueueQuery(params)}`,
      )
      return {
        items: envelope.data,
        pagination: envelope.meta.pagination,
        serverTime: envelope.meta.serverTime,
      }
    },
    enabled,
    staleTime: STALE_TIME_MS,
    placeholderData: keepPreviousData,
  })
}
