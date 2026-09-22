/**
 * useAnalyticsHome — the ONE page-level fetch for the role-scoped analytics home
 * (Story 8-2b, Task 2, AC6). Mirrors `useDashboard` (8-1b): `apiFetchWithMeta`
 * so `meta.serverTime` survives (analytics reads the server clock, never
 * `Date.now()` in render), the FW-3 default 30s staleTime, and the full
 * `{ data, meta }` envelope as the query data (consumers read `query.data?.data`).
 *
 * The endpoint is ungated but role-resolved server-side (`tc.Role`) — a student
 * is 403'd, so the dispatcher redirects them BEFORE this hook ever mounts (AC3).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta, type EnvelopeWithMeta } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { analyticsKeys } from './analyticsKeys'

export type AnalyticsHome = components['schemas']['AnalyticsHome']
export type EnvelopeMeta = components['schemas']['EnvelopeMeta']
export type AnalyticsHomeEnvelope = EnvelopeWithMeta<AnalyticsHome, EnvelopeMeta>

/** The role-scoped analytics-home read (teacher = own classes, owner/admin = center-wide). */
export function useAnalyticsHome() {
  return useQuery({
    queryKey: analyticsKeys.home(),
    queryFn: () =>
      apiFetchWithMeta<AnalyticsHome, EnvelopeMeta>('/api/analytics'),
    staleTime: DEFAULT_STALE_TIME_MS,
  })
}
