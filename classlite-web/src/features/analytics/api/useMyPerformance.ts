/**
 * useMyPerformance — the ONE aggregate fetch for the calling student's own
 * performance (Story 8-3b, Task 1, AC4). One `GET /api/analytics/me` returns the
 * whole softened view; the backend sets framing "student" and STRIPS every peer
 * field service-side (FR-50, D5). This hook NEVER calls /students/{id}. A 500
 * blanks the view (single inline error + retry, AC24).
 */
import { useQuery } from '@tanstack/react-query'
import { apiFetchWithMeta } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { analyticsKeys } from './analyticsKeys'
import type { EnvelopeMeta, StudentPerformance } from './useStudentPerformance'

/** The calling student's own aggregate performance read. */
export function useMyPerformance() {
  return useQuery({
    queryKey: analyticsKeys.me(),
    queryFn: () =>
      apiFetchWithMeta<StudentPerformance, EnvelopeMeta>('/api/analytics/me'),
    staleTime: DEFAULT_STALE_TIME_MS,
  })
}
