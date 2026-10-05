/**
 * DowngradeConfirmModal — schedule an at-renewal plan downgrade (Story 9-2b,
 * AC4/AC5). A confirm-flow (not RHF): it states the at-renewal semantics —
 * takes effect at the next renewal, data is NOT removed (access is only
 * restricted if the new tier's limits are exceeded at renewal), the current plan
 * stays active until the period ends — all via i18n, then calls
 * `useScheduleDowngrade`.
 *
 * On success it closes (the optimistic triple already reflected the pending state
 * on the dashboard). A 422 `VALIDATION_ERROR` (not a lower tier / unbound sub)
 * surfaces inline — never a raw code/stack (UX-1 error).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { components } from '@/lib/api/client'
import { useScheduleDowngrade } from '../api/useScheduleDowngrade'
import { planDisplayName } from '../lib/planDisplay'

type PlanId = components['schemas']['BillingPendingDowngrade']['plan']
type BillingCycle =
  components['schemas']['BillingProrationPreview']['targetBillingCycle']

export interface DowngradeConfirmModalProps {
  open: boolean
  onClose: () => void
  targetPlan: PlanId
  billingCycle: BillingCycle
  /** The renewal boundary the downgrade applies at (current period end), or null. */
  effectiveAt: string | null
}

export function DowngradeConfirmModal({
  open,
  onClose,
  targetPlan,
  billingCycle,
  effectiveAt,
}: DowngradeConfirmModalProps): ReactElement {
  const { t } = useTranslation()
  const schedule = useScheduleDowngrade()

  const close = (next: boolean): void => {
    if (!next) onClose()
  }

  const onConfirm = (): void => {
    schedule.mutate(
      { plan: targetPlan, billingCycle },
      { onSuccess: () => onClose() },
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent data-testid="downgrade-confirm-modal">
        <DialogHeader>
          <DialogTitle>
            {t('billing.downgrade.title', { tier: planDisplayName(targetPlan) })}
          </DialogTitle>
          {effectiveAt ? (
            <DialogDescription>
              {t('billing.downgrade.atRenewal', { date: effectiveAt })}
            </DialogDescription>
          ) : null}
        </DialogHeader>

        <p className="text-sm text-slate-700">{t('billing.downgrade.noDataLoss')}</p>
        <p className="text-sm text-slate-600">{t('billing.downgrade.stayActive')}</p>
        {/* Name the billing cycle this schedules, so inheriting the picker's
            monthly/annual price-view toggle is a visible, deliberate choice. */}
        <p className="text-sm font-medium text-slate-700" data-testid="downgrade-confirm-cycle">
          {t(
            billingCycle === 'annual'
              ? 'billing.downgrade.cycleNoteAnnual'
              : 'billing.downgrade.cycleNoteMonthly',
          )}
        </p>

        {schedule.isError ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            data-testid="downgrade-confirm-error"
          >
            {t('billing.downgrade.error')}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={schedule.isPending}>
            {t('billing.downgrade.cancel')}
          </Button>
          <Button
            data-testid="downgrade-confirm-submit"
            onClick={onConfirm}
            disabled={schedule.isPending}
          >
            {t('billing.downgrade.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
