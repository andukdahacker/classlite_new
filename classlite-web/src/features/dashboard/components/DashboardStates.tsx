/**
 * DashboardStates — the shared loading + error surfaces for the three role
 * dashboards (Story 8-1b, UX-1 trilogy). One skeleton shape (row/strip-shaped,
 * never a centered spinner) and one inline error alert (a `role="alert"` with a
 * single retry that re-issues the fetch — never a full-page error) so the
 * teacher/owner/student surfaces stay visually consistent and each keeps its own
 * i18n copy.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/** Row + strip-shaped skeletons mirroring a loaded dashboard (UX-1 loading). */
export function DashboardSkeleton(): ReactElement {
  return (
    <div data-testid="dashboard-skeleton" aria-busy="true" className="space-y-6">
      <div className="h-9 w-64 animate-pulse rounded bg-slate-200" />
      <div className="h-24 animate-pulse rounded-2xl bg-slate-200" />
      <div className="grid gap-4 md:grid-cols-3">
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-48 animate-pulse rounded-2xl bg-slate-200" />
      </div>
    </div>
  )
}

export interface DashboardErrorAlertProps {
  /** i18n key for the human error message (never an HTTP code / stack trace). */
  messageKey: string
  /** i18n key for the retry button label. */
  retryLabelKey: string
  /** Re-issues the dashboard fetch (TanStack Query `refetch`). */
  onRetry: () => void
}

/** Inline `role="alert"` with a single retry — the UX-1 error branch. */
export function DashboardErrorAlert({
  messageKey,
  retryLabelKey,
  onRetry,
}: DashboardErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4 text-sm text-[var(--cl-ink)]"
    >
      <p>{t(messageKey)}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t(retryLabelKey)}
      </Button>
    </div>
  )
}
