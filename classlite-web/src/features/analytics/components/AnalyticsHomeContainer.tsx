/**
 * AnalyticsHomeContainer — owns the analytics-home fetch + three-state trilogy
 * (Story 8-2b, Task 4, UX-1). Split from the presentational `AnalyticsHome` so
 * the fetch mounts ONLY for a staff role (the dispatcher renders this for
 * teacher/owner/admin; a student is redirected BEFORE this ever mounts, so
 * `GET /api/analytics` is never called for a student — AC3/AC22d).
 *
 * Loading → the shared row-shaped skeleton (never a centered spinner). Error →
 * the inline `role="alert"` + retry that re-issues the fetch. Success → the
 * presentational home over `query.data.data` (the unwrapped envelope block).
 */
import type { ReactElement } from 'react'
import {
  DashboardErrorAlert,
  DashboardSkeleton,
} from '@/features/dashboard/components/DashboardStates'
import { useAnalyticsHome } from '../api/useAnalyticsHome'
import { AnalyticsHome } from './AnalyticsHome'

export function AnalyticsHomeContainer(): ReactElement {
  const query = useAnalyticsHome()

  if (query.isPending) return <DashboardSkeleton />
  if (query.isError) {
    return (
      <DashboardErrorAlert
        messageKey="analytics.error.message"
        retryLabelKey="analytics.error.retry"
        onRetry={() => {
          void query.refetch()
        }}
      />
    )
  }
  return <AnalyticsHome data={query.data.data} />
}
