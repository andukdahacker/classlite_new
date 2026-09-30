/**
 * PlanPickerPage — s68, `/settings/billing/plans`, Owner-only (Story 9-1b,
 * AC3–AC6/AC20). Three tier cards read entirely from `GET /api/billing/plans`
 * (prices + VAT split never hardcoded, D25) with the caller's current plan
 * highlighted from `GET /api/billing`.
 *
 * The monthly/annual toggle is client-only UI state (a local `useState`, never
 * the TanStack cache — AC4). It uses local state rather than a Zustand store
 * because the ATDD reds run in-order against a shared module scope with no
 * store-reset hook; cross-navigation persistence (the conversion nicety) is
 * FU-9-1B-TOGGLE-PERSIST for 9.2, where the picker gains the real purchase
 * flow. No "Upgrade" verb — non-current CTAs are "Talk to us" (D-9-1b-1).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { useBillingPlans } from './api/useBillingPlans'
import { useBillingSummary } from './api/useBillingSummary'
import { PlanCard } from './components/PlanCard'

export function PlanPickerPage(): ReactElement {
  const { t } = useTranslation()
  const plansQuery = useBillingPlans()
  const summaryQuery = useBillingSummary()
  const [annual, setAnnual] = useState(false)

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
  const currentPlan = summaryQuery.data.plan

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
            onClick={() => setAnnual((current) => !current)}
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
            isCurrent={entry.plan === currentPlan}
          />
        ))}
      </div>
    </div>
  )
}
