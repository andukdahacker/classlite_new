/**
 * BillingDashboardPage — s69, `/settings/billing`, Owner-only (Story 9-1b,
 * AC7–AC11). A current-plan card + live usage meters for teacher seats,
 * classes, AI credits, and storage, all driven by `GET /api/billing`.usage.
 * NO next-invoice / payment-method card (D-DASH → 9.2).
 *
 * The server owns every derived flag (`approaching`, `isFree`,
 * `creditsApplicable`), so the FE renders them verbatim (D22/D24):
 *   - a Free-tier center (`isFree`) never sees an alarming `0/0` AI-credits
 *     meter — it is replaced by an honest "not included — see plans" CTA, and
 *     the dashboard leads with a "See plans" CTA (D24 / D-9-1b-1, no "Upgrade");
 *   - an unlimited meter (`max === null`) renders "Unlimited" with `.warn`
 *     suppressed (guarded inside `PlanUsageMeter`).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PlanUsageMeter } from '@/components/domain/PlanUsageMeter'
import { useBillingSummary } from './api/useBillingSummary'
import { planDisplayName } from './lib/planDisplay'

const PLANS_PATH = '/settings/billing/plans'

export function BillingDashboardPage(): ReactElement {
  const { t } = useTranslation()
  const summaryQuery = useBillingSummary()

  if (summaryQuery.isPending) {
    return (
      <div
        className="space-y-4"
        data-testid="billing-dashboard-skeleton"
        role="status"
        aria-busy="true"
      >
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-24 w-full" />
        <div className="grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </div>
    )
  }

  if (summaryQuery.isError) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
        data-testid="billing-dashboard-error"
      >
        <span>{t('billing.error.loadFailed')}</span>
        <Button size="sm" variant="outline" onClick={() => summaryQuery.refetch()}>
          {t('billing.error.retry')}
        </Button>
      </div>
    )
  }

  const summary = summaryQuery.data
  const { usage } = summary

  return (
    <div className="space-y-6" data-testid="billing-dashboard">
      <section className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="font-fraunces text-2xl text-slate-900">
              {t('billing.dashboard.currentPlan', { tier: planDisplayName(summary.plan) })}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {t(`billing.dashboard.cycle.${summary.billingCycle}`)}
              {summary.currentPeriodEnd
                ? ` · ${t('billing.dashboard.periodEnd', { val: summary.currentPeriodEnd })}`
                : ''}
            </p>
          </div>
          {summary.isFree ? (
            <a
              href={PLANS_PATH}
              className="inline-flex w-fit items-center rounded-md bg-[color:var(--cl-accent)] px-3 py-1.5 text-sm font-medium text-white"
              data-testid="billing-dashboard-see-plans"
            >
              {t('billing.dashboard.seePlans')}
            </a>
          ) : null}
        </div>
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <PlanUsageMeter
          testKey="teacherSeats"
          unit="count"
          value={usage.teacherSeats.current}
          max={usage.teacherSeats.max}
          warn={usage.teacherSeats.approaching}
          label={t('billing.dashboard.meterLabel.teacherSeats')}
        />
        <PlanUsageMeter
          testKey="classes"
          unit="count"
          value={usage.classes.current}
          max={usage.classes.max}
          warn={usage.classes.approaching}
          label={t('billing.dashboard.meterLabel.classes')}
        />
        <PlanUsageMeter
          testKey="storage"
          unit="bytes"
          value={usage.storage.usedBytes}
          max={usage.storage.limitBytes}
          warn={usage.storage.approaching}
          label={t('billing.dashboard.meterLabel.storage')}
        />
        {summary.creditsApplicable ? (
          <PlanUsageMeter
            testKey="aiCredits"
            unit="credits"
            value={usage.aiCredits.available}
            max={usage.aiCredits.monthlyAllocation}
            warn={false}
            resetAt={usage.aiCredits.resetAt}
            label={t('billing.dashboard.meterLabel.aiCredits')}
          />
        ) : (
          <a
            href={PLANS_PATH}
            className="flex flex-col gap-1 rounded-xl border border-dashed border-slate-300 p-4 text-sm text-slate-600"
            data-testid="billing-ai-not-included"
          >
            {t('billing.dashboard.aiNotIncluded')}
          </a>
        )}
      </section>
    </div>
  )
}
