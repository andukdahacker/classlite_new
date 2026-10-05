/**
 * PendingDowngradeCard — the dashboard surface for a scheduled downgrade (Story
 * 9-2b, AC6). Rendered on `BillingDashboardPage` when the (normalized)
 * `pendingDowngrade` is non-null. Shows "Downgrade to {plan} scheduled for {date}"
 * with a "Cancel downgrade" action (`useCancelDowngrade`) that clears the pending
 * state optimistically and reconciles on the summary invalidate.
 *
 * Per D26 an upgrade also clears a pending downgrade (single slot) server-side —
 * this card simply disappears once the next `GET /api/billing` poll returns a null
 * pendingDowngrade, so no extra wiring is needed here.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useCancelDowngrade } from '../api/useScheduleDowngrade'
import { planDisplayName } from '../lib/planDisplay'
import type { PendingDowngrade } from '../lib/pendingDowngrade'

export interface PendingDowngradeCardProps {
  pending: PendingDowngrade
}

export function PendingDowngradeCard({
  pending,
}: PendingDowngradeCardProps): ReactElement {
  const { t } = useTranslation()
  const cancel = useCancelDowngrade()

  return (
    <section
      className="flex flex-col gap-2 rounded-xl border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] p-4"
      data-testid="pending-downgrade-card"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-800">
          {t('billing.pending.scheduled', {
            tier: planDisplayName(pending.plan),
            date: pending.effectiveAt,
          })}
        </p>
        <Button
          size="sm"
          variant="outline"
          data-testid="pending-downgrade-cancel"
          onClick={() => cancel.mutate()}
          disabled={cancel.isPending}
        >
          {t('billing.pending.cancel')}
        </Button>
      </div>
      {/* Without this the optimistic rollback makes the card silently reappear on a
          failed cancel — the click looks like it did nothing. */}
      {cancel.isError ? (
        <p
          role="alert"
          className="text-sm text-[color:var(--cl-red)]"
          data-testid="pending-downgrade-cancel-error"
        >
          {t('billing.pending.cancelError')}
        </p>
      ) : null}
    </section>
  )
}
