/**
 * PlanPickerPage — s68, `/settings/billing/plans`, Owner-only (Story 9-1b; the real
 * upgrade/downgrade flow lands in 9-2b).
 *
 * Three tier cards read entirely from `GET /api/billing/plans` (prices + VAT split
 * never hardcoded, D25) with the caller's current plan highlighted from
 * `GET /api/billing`. Each non-current card opens the s71 UpgradeModal (higher tier)
 * or the downgrade-confirm modal (lower tier) — replacing 9-1b's `mailto:` placeholder.
 *
 * The monthly/annual toggle now persists in a UI-only Zustand store
 * (`useBillingCycleStore`, AC16 / FU-9-1B-TOGGLE-PERSIST) so the selection — the
 * FR-61 conversion lever — survives navigation within the session; the upgrade modal
 * reads the same billing-cycle intent.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import type { components } from '@/lib/api/client'
import { useBillingPlans } from './api/useBillingPlans'
import { useBillingSummary } from './api/useBillingSummary'
import { useBillingCycleStore } from './store/useBillingCycleStore'
import { PlanCard } from './components/PlanCard'
import { UpgradeModal } from './components/UpgradeModal'
import { DowngradeConfirmModal } from './components/DowngradeConfirmModal'

type PlanId = components['schemas']['BillingSummary']['plan']
type UpgradeTarget = components['schemas']['BillingProrationPreview']['targetPlan']

export function PlanPickerPage(): ReactElement {
  const { t } = useTranslation()
  const plansQuery = useBillingPlans()
  const summaryQuery = useBillingSummary()
  const annual = useBillingCycleStore((s) => s.annual)
  const toggleAnnual = useBillingCycleStore((s) => s.toggle)
  const [upgradeTarget, setUpgradeTarget] = useState<UpgradeTarget | null>(null)
  const [downgradeTarget, setDowngradeTarget] = useState<PlanId | null>(null)

  if (plansQuery.isPending || summaryQuery.isPending) {
    return (
      <div
        className="space-y-4"
        data-testid="plan-picker-skeleton"
        role="status"
        aria-busy="true"
      >
        <Skeleton className="h-8 w-56" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    )
  }

  if (plansQuery.isError || summaryQuery.isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
        data-testid="plan-picker-error"
      >
        <span>{t('billing.error.loadFailed')}</span>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            void plansQuery.refetch()
            void summaryQuery.refetch()
          }}
        >
          {t('billing.error.retry')}
        </Button>
      </div>
    )
  }

  const plans = plansQuery.data.plans
  const summary = summaryQuery.data
  const currentPlan = summary.plan
  const billingCycle = annual ? 'annual' : 'monthly'

  return (
    <div className="space-y-6" data-testid="plan-picker">
      <div className="flex items-center gap-3">
        <h1 className="font-fraunces text-2xl text-slate-900">
          {t('billing.picker.title')}
        </h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-slate-600">
            {t('billing.picker.monthlyLabel')}
          </span>
          <button
            type="button"
            role="switch"
            aria-checked={annual}
            aria-label={t('billing.picker.annualToggle')}
            onClick={() => toggleAnnual()}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              annual ? 'bg-[color:var(--cl-accent)]' : 'bg-slate-300'
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${
                annual ? 'translate-x-5' : ''
              }`}
            />
          </button>
          <span className="text-sm text-slate-600">
            {t('billing.picker.annualLabel')}
          </span>
          {annual ? (
            <span
              className="rounded-full bg-[color:var(--cl-tint-gold)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-amber)]"
              data-testid="plan-picker-annual-savings"
            >
              {t('billing.picker.annualSavings')}
            </span>
          ) : null}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {plans.map((entry) => (
          <PlanCard
            key={entry.plan}
            entry={entry}
            annual={annual}
            currentPlan={currentPlan}
            onUpgrade={setUpgradeTarget}
            onDowngrade={setDowngradeTarget}
          />
        ))}
      </div>

      {upgradeTarget ? (
        <UpgradeModal
          open
          onClose={() => setUpgradeTarget(null)}
          targetPlan={upgradeTarget}
          billingCycle={billingCycle}
        />
      ) : null}
      {downgradeTarget ? (
        <DowngradeConfirmModal
          open
          onClose={() => setDowngradeTarget(null)}
          targetPlan={downgradeTarget}
          billingCycle={billingCycle}
          effectiveAt={summary.currentPeriodEnd}
        />
      ) : null}
    </div>
  )
}
