/**
 * BillingDashboardPage — s69, `/settings/billing`, Owner-only (Story 9-1b;
 * extended in 9-2b). A current-plan card + live usage meters (teacher seats,
 * classes, AI credits, storage) driven by `GET /api/billing`.usage.
 *
 * Story 9-2b adds the D-DASH cards + the real upgrade / add-on entry points:
 *   - a scheduled-downgrade card + cancel (AC6);
 *   - a next-invoice card (null → omitted, no empty shell — AC11);
 *   - a payment-method card showing the real `{brand, last4}` or degrading to
 *     "Managed securely by Polar" when null (AC12);
 *   - an "Upgrade" affordance (non-Studio) opening the s71 UpgradeModal to the next
 *     tier, and a "Buy more credits" affordance on the AI-credits meter opening the
 *     AddonPacksModal (AC2/AC7 trigger points).
 *
 * The server owns every derived flag (`approaching`, `isFree`, `creditsApplicable`),
 * rendered verbatim (D22/D24). Money comes from server fields via `formatVnd` —
 * never recomputed (D25).
 */
import { useEffect, useState, type ReactElement } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { Skeleton } from '@/components/ui/skeleton'
import { Button } from '@/components/ui/button'
import { PlanUsageMeter } from '@/components/domain/PlanUsageMeter'
import type { components } from '@/lib/api/client'
import { billingKeys } from './api/billingKeys'
import { useBillingSummary } from './api/useBillingSummary'
import { planDisplayName } from './lib/planDisplay'
import { formatVnd } from './lib/formatVnd'
import { normalizeSummaryPending } from './lib/pendingDowngrade'
import { PendingDowngradeCard } from './components/PendingDowngradeCard'
import { UpgradeModal } from './components/UpgradeModal'
import { AddonPacksModal } from './components/AddonPacksModal'

type PlanId = components['schemas']['BillingSummary']['plan']
type UpgradeTarget = components['schemas']['BillingProrationPreview']['targetPlan']

const PLANS_PATH = '/settings/billing/plans'

/** The next tier up, or null when already on the top (Studio) / unknown. */
function nextTierUp(plan: PlanId): UpgradeTarget | null {
  if (plan === 'free') return 'pro'
  if (plan === 'pro') return 'studio'
  return null
}

const CHECKOUT_RETURN_PARAM = 'checkout'
const CHECKOUT_RETURN_SUCCESS = 'success'

export function BillingDashboardPage(): ReactElement {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const summaryQuery = useBillingSummary()
  const [upgradeOpen, setUpgradeOpen] = useState(false)
  const [addonsOpen, setAddonsOpen] = useState(false)
  const [reconciling, setReconciling] = useState(false)

  // AC3: the Polar hosted checkout returns via a full-page redirect carrying
  // `?checkout=success`. The subscription/credit change is webhook-confirmed, so
  // bridge the confirmation window: refetch the summary and show an "updating…"
  // affordance until the fresh read lands, then strip the param so a reload/back
  // doesn't re-trigger it. One-shot imperative URL handling — a permitted useEffect
  // (not data fetching; the query owns the fetch). NOTE: the exact return param must
  // be validated against Polar's real redirect at the D29a staging smoke (see story
  // §Enforcement arming) — the backend `success_url` emits this param.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get(CHECKOUT_RETURN_PARAM) !== CHECKOUT_RETURN_SUCCESS) return
    setReconciling(true)
    // Keep the affordance up until the fresh summary read settles (deterministic —
    // no isFetching race), then clear it whether the refetch succeeded or not.
    void queryClient
      .invalidateQueries({ queryKey: billingKeys.summary() })
      .finally(() => setReconciling(false))
    params.delete(CHECKOUT_RETURN_PARAM)
    const query = params.toString()
    window.history.replaceState(
      null,
      '',
      `${window.location.pathname}${query ? `?${query}` : ''}`,
    )
  }, [queryClient])

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
  const pendingDowngrade = normalizeSummaryPending(summary.pendingDowngrade)
  const upgradeTarget = nextTierUp(summary.plan)

  return (
    <div className="space-y-6" data-testid="billing-dashboard">
      {reconciling ? (
        <p
          role="status"
          aria-live="polite"
          className="rounded-md border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] px-4 py-2 text-sm text-slate-700"
          data-testid="billing-reconcile-banner"
        >
          {t('billing.reconcile.updating')}
        </p>
      ) : null}

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
            <a
              href="/settings/billing/invoices"
              className="mt-1 inline-flex w-fit text-sm font-medium text-[color:var(--cl-accent)] underline"
              data-testid="billing-dashboard-invoice-history"
            >
              {t('billing.dashboard.invoiceHistory')}
            </a>
          </div>
          {summary.isFree ? (
            <a
              href={PLANS_PATH}
              className="inline-flex w-fit items-center rounded-md bg-[color:var(--cl-accent)] px-3 py-1.5 text-sm font-medium text-white"
              data-testid="billing-dashboard-see-plans"
            >
              {t('billing.dashboard.seePlans')}
            </a>
          ) : upgradeTarget ? (
            <Button
              data-testid="billing-dashboard-upgrade"
              onClick={() => setUpgradeOpen(true)}
            >
              {t('billing.action.upgradeTo', { tier: planDisplayName(upgradeTarget) })}
            </Button>
          ) : null}
        </div>
      </section>

      {pendingDowngrade ? <PendingDowngradeCard pending={pendingDowngrade} /> : null}

      {summary.nextInvoice ? (
        <section
          className="rounded-xl border border-slate-200 p-4"
          data-testid="next-invoice-card"
        >
          <h2 className="text-sm font-medium text-slate-500">
            {t('billing.nextInvoice.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-800 tabular-nums">
            {t('billing.nextInvoice.body', {
              amount: formatVnd(summary.nextInvoice.amountVnd),
              date: summary.nextInvoice.dueDate,
            })}
          </p>
        </section>
      ) : null}

      {!summary.isFree ? (
        <section
          className="rounded-xl border border-slate-200 p-4"
          data-testid="payment-method-card"
        >
          <h2 className="text-sm font-medium text-slate-500">
            {t('billing.paymentMethod.title')}
          </h2>
          <p className="mt-1 text-sm text-slate-800">
            {summary.paymentMethod
              ? t('billing.paymentMethod.onFile', {
                  brand: summary.paymentMethod.brand,
                  last4: summary.paymentMethod.last4,
                })
              : t('billing.paymentMethod.managed')}
          </p>
        </section>
      ) : null}

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
          <div className="flex flex-col gap-2">
            <PlanUsageMeter
              testKey="aiCredits"
              unit="credits"
              value={usage.aiCredits.available}
              max={usage.aiCredits.monthlyAllocation}
              warn={false}
              resetAt={usage.aiCredits.resetAt}
              label={t('billing.dashboard.meterLabel.aiCredits')}
            />
            <Button
              size="sm"
              variant="outline"
              className="w-fit"
              data-testid="billing-buy-credits"
              onClick={() => setAddonsOpen(true)}
            >
              {t('billing.addons.cta')}
            </Button>
          </div>
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

      {upgradeTarget ? (
        <UpgradeModal
          open={upgradeOpen}
          onClose={() => setUpgradeOpen(false)}
          targetPlan={upgradeTarget}
          billingCycle={summary.billingCycle}
        />
      ) : null}
      <AddonPacksModal open={addonsOpen} onClose={() => setAddonsOpen(false)} />
    </div>
  )
}
