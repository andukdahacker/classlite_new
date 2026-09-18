/**
 * useDashboard — the ONE page-level fetch for the role-scoped dashboard
 * (Story 8-1b, Task 2, AC3). The dispatcher mounts exactly one role component
 * and that component calls this hook once, so `/api/dashboard` is the only
 * network call the page makes.
 *
 * Uses `apiFetchWithMeta`, NOT `apiFetch` (D3): the plain unwrap DROPS `meta`,
 * and every relative-time affordance on these dashboards — the owner "live now"
 * flag, the student due countdown, the "N ago" question ages (D16) — reads
 * `meta.serverTime` so the clock is the server's, skew- and hydration-immune.
 * The query data is therefore the full `{ data, meta }` envelope; consumers read
 * `query.data?.data` for the role block and `query.data?.meta.serverTime` for
 * the clock.
 *
 * The endpoint is ungated but role-resolved server-side (`tc.Role`) and only
 * ever returns the caller's own block — a FE role-branch slip surfaces the wrong
 * layout, never another tenant's data (8-1a).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta, type EnvelopeWithMeta } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { dashboardKeys } from './dashboardKeys'

export type DashboardData = components['schemas']['DashboardData']
export type EnvelopeMeta = components['schemas']['EnvelopeMeta']
export type DashboardEnvelope = EnvelopeWithMeta<DashboardData, EnvelopeMeta>

/** The role-scoped dashboard read. FW-3 default 30s staleTime — a dashboard is
 *  a periodic glance, not a live feed, so the project default is correct. */
export function useDashboard() {
  return useQuery({
    queryKey: dashboardKeys.data(),
    queryFn: () =>
      apiFetchWithMeta<DashboardData, EnvelopeMeta>('/api/dashboard'),
    staleTime: DEFAULT_STALE_TIME_MS,
  })
}
