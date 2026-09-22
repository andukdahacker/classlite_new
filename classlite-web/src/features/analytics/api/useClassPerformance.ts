/**
 * useClassPerformance — the ONE aggregate fetch for the class-performance view
 * (Story 8-2b, Task 2, AC10). One `GET /api/analytics/classes/{id}` returns the
 * whole view (stats + band-over-time + heatmap + mistakes + at-risk + on-time),
 * so a 500 blanks the view (single inline error + retry) — there is no
 * partial-failure surface (Murat, AC22). Mirrors `useDashboard`:
 * `apiFetchWithMeta`, FW-3 default staleTime, full envelope as query data.
 *
 * The endpoint is role/tenant-scoped server-side; a caller who may not view the
 * class gets 404 CLASS_NOT_FOUND (non-disclosure, D4) — the view renders an
 * inline not-found, never a raw error (AC11).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta, type EnvelopeWithMeta } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { analyticsKeys } from './analyticsKeys'

export type ClassPerformance = components['schemas']['ClassPerformance']
export type EnvelopeMeta = components['schemas']['EnvelopeMeta']
export type ClassPerformanceEnvelope = EnvelopeWithMeta<
  ClassPerformance,
  EnvelopeMeta
>

/** The single aggregate class-performance read for one class id. */
export function useClassPerformance(id: string) {
  return useQuery({
    queryKey: analyticsKeys.classPerf(id),
    queryFn: () =>
      apiFetchWithMeta<ClassPerformance, EnvelopeMeta>(
        `/api/analytics/classes/${id}`,
      ),
    staleTime: DEFAULT_STALE_TIME_MS,
  })
}
