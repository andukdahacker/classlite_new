/**
 * UpgradeModal — the s71 upgrade flow (Story 9-2b, AC1/AC2/AC3/AC13/AC17/AC18).
 *
 * Opens for a target `plan` + `billingCycle`, fetches the Polar-verbatim proration
 * breakdown (`useProrationPreview`), shows a before→after limit comparison + the
 * charge block (subtotal → −credit → +VAT → charged-today), and on confirm starts
 * a Polar hosted checkout (`useCreateCheckout` with `kind: "upgrade"`) that redirects
 * the browser. NO local plan/credit state is mutated — the change is webhook-confirmed
 * and reconciled on the next `GET /api/billing` (D2/D4).
 *
 * Money is rendered VERBATIM from the preview — every amount is a server integer VND
 * via `formatVnd`, never recomputed client-side (D6/D25). The mock's USD placeholders
 * and (days × daily-rate) formula are ignored.
 *
 * Desktop-only (UX-4): on mobile widths it shows an honest "open on desktop" hint
 * rather than a squished modal. The trilogy (skeleton / inline-retry / success) runs
 * over the proration query (UX-1).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { formatDataSize } from '@/lib/formatDataSize'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { components } from '@/lib/api/client'
import { useBillingSummary } from '../api/useBillingSummary'
import { useBillingPlans } from '../api/useBillingPlans'
import { useProrationPreview } from '../api/useProrationPreview'
import { useCreateCheckout } from '../api/useCreateCheckout'
import { formatVnd } from '../lib/formatVnd'
import { planDisplayName } from '../lib/planDisplay'

type BillingLimits = components['schemas']['BillingLimits']
type PlanId = components['schemas']['BillingProrationPreview']['targetPlan']
type BillingCycle =
  components['schemas']['BillingProrationPreview']['targetBillingCycle']

export interface UpgradeModalProps {
  open: boolean
  onClose: () => void
  targetPlan: PlanId
  billingCycle: BillingCycle
}

function limitRows(
  limits: BillingLimits,
  unlimited: string,
  language: string,
): { key: string; value: string }[] {
  const n = (v: number | null): string => (v === null ? unlimited : String(v))
  return [
    { key: 'billing.picker.limits.teachers', value: n(limits.teachers) },
    { key: 'billing.picker.limits.classes', value: n(limits.classes) },
    { key: 'billing.picker.limits.studentsPerClass', value: n(limits.studentsPerClass) },
    { key: 'billing.picker.limits.aiCredits', value: n(limits.aiCreditsPerMonth) },
    { key: 'billing.picker.limits.storage', value: formatDataSize(limits.storageBytes, language) },
  ]
}

export function UpgradeModal({
  open,
  onClose,
  targetPlan,
  billingCycle,
}: UpgradeModalProps): ReactElement {
  const { t, i18n } = useTranslation()
  const isDesktop = useIsDesktop()
  const summaryQuery = useBillingSummary()
  const plansQuery = useBillingPlans()
  const prorationQuery = useProrationPreview(
    targetPlan,
    billingCycle,
    open && isDesktop,
  )
  const checkout = useCreateCheckout()

  const close = (next: boolean): void => {
    if (!next) onClose()
  }

  // Desktop-only (UX-4): honest hint instead of a squished modal on mobile.
  if (!isDesktop) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent data-testid="upgrade-modal-mobile-hint">
          <DialogHeader>
            <DialogTitle>{t('billing.upgrade.mobileHintTitle')}</DialogTitle>
            <DialogDescription>{t('billing.upgrade.mobileHint')}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  const unlimited = t('billing.meter.unlimited')
  const targetEntry = plansQuery.data?.plans.find((p) => p.plan === targetPlan)
  const isLoading =
    summaryQuery.isPending || plansQuery.isPending || prorationQuery.isPending

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-[640px]" data-testid="upgrade-modal">
        <DialogHeader>
          <span className="font-mono text-xs uppercase tracking-wide text-slate-400">
            {t('billing.upgrade.eyebrow')}
          </span>
          <DialogTitle className="font-fraunces text-2xl">
            {summaryQuery.data
              ? `${planDisplayName(summaryQuery.data.plan)} → ${planDisplayName(targetPlan)}`
              : planDisplayName(targetPlan)}
          </DialogTitle>
          <DialogDescription>{t('billing.upgrade.effectiveNow')}</DialogDescription>
        </DialogHeader>

        {isLoading ? (
          <div
            className="space-y-3"
            data-testid="upgrade-modal-skeleton"
            role="status"
            aria-busy="true"
          >
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : prorationQuery.isError || !prorationQuery.data ? (
          <div
            role="alert"
            className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
            data-testid="upgrade-modal-error"
          >
            <span>{t('billing.upgrade.loadError')}</span>
            <Button size="sm" variant="outline" onClick={() => prorationQuery.refetch()}>
              {t('billing.error.retry')}
            </Button>
          </div>
        ) : (
          <>
            {summaryQuery.data && targetEntry ? (
              <section data-testid="upgrade-modal-whatchanges">
                <h3 className="mb-2 text-sm font-medium text-slate-800">
                  {t('billing.upgrade.whatChanges')}
                </h3>
                <div className="grid grid-cols-[1fr_auto_1fr] items-start gap-2 text-xs">
                  <div className="rounded-lg border border-slate-200 p-3">
                    <p className="mb-1 font-medium text-slate-500">
                      {t('billing.upgrade.currentHeader')}
                    </p>
                    <ul className="flex flex-col gap-0.5 text-slate-600">
                      {limitRows(summaryQuery.data.limits, unlimited, i18n.language).map((row) => (
                        <li key={row.key}>{t(row.key, { value: row.value })}</li>
                      ))}
                    </ul>
                  </div>
                  <span aria-hidden className="self-center text-slate-400">→</span>
                  <div className="rounded-lg border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] p-3">
                    <p className="mb-1 font-medium text-[color:var(--cl-amber)]">
                      {planDisplayName(targetPlan)}
                    </p>
                    <ul className="flex flex-col gap-0.5 font-medium text-slate-800">
                      {limitRows(targetEntry.limits, unlimited, i18n.language).map((row) => (
                        <li key={row.key}>{t(row.key, { value: row.value })}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            ) : null}

            <section
              className="rounded-lg border border-slate-200 p-4"
              data-testid="upgrade-modal-charge"
            >
              <h3 className="mb-2 text-sm font-medium text-slate-800">
                {t('billing.upgrade.chargeTitle')}
              </h3>
              <dl className="flex flex-col gap-1 text-sm tabular-nums">
                <div className="flex justify-between">
                  <dt className="text-slate-600">{t('billing.upgrade.subtotal')}</dt>
                  <dd data-testid="upgrade-charge-subtotal">{formatVnd(prorationQuery.data.subtotalVnd)}</dd>
                </div>
                <div className="flex justify-between text-[color:var(--cl-green)]">
                  <dt>{t('billing.upgrade.creditApplied')}</dt>
                  <dd data-testid="upgrade-charge-credit">
                    {prorationQuery.data.creditAppliedVnd === 0
                      ? formatVnd(0)
                      : `−${formatVnd(prorationQuery.data.creditAppliedVnd)}`}
                  </dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-slate-600">{t('billing.upgrade.vat')}</dt>
                  <dd data-testid="upgrade-charge-vat">
                    {prorationQuery.data.vatVnd === 0
                      ? formatVnd(0)
                      : `+${formatVnd(prorationQuery.data.vatVnd)}`}
                  </dd>
                </div>
                <div className="mt-1 flex justify-between border-t border-slate-200 pt-1 font-semibold text-[color:var(--cl-accent)]">
                  <dt>{t('billing.upgrade.chargedToday')}</dt>
                  <dd data-testid="upgrade-charge-today" className="font-mono text-base">
                    {formatVnd(prorationQuery.data.chargedTodayVnd)}
                  </dd>
                </div>
              </dl>
              {summaryQuery.data?.currentPeriodEnd ? (
                <p className="mt-2 text-xs text-slate-400">
                  {t('billing.upgrade.renewalFootnote', {
                    date: summaryQuery.data.currentPeriodEnd,
                    total: formatVnd(prorationQuery.data.totalVnd),
                  })}
                </p>
              ) : null}
            </section>
          </>
        )}

        {checkout.isError ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            data-testid="upgrade-modal-checkout-error"
          >
            {t('billing.upgrade.checkoutError')}
          </p>
        ) : null}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={checkout.isPending}>
            {t('billing.upgrade.cancel')}
          </Button>
          <Button
            data-testid="upgrade-modal-confirm"
            disabled={isLoading || prorationQuery.isError || !prorationQuery.data || checkout.isPending}
            onClick={() =>
              checkout.mutate({
                kind: 'upgrade',
                plan: targetPlan,
                billingCycle,
                addonPackId: null,
              })
            }
          >
            {prorationQuery.data
              ? t('billing.upgrade.confirm', {
                  amount: formatVnd(prorationQuery.data.chargedTodayVnd),
                })
              : t('billing.upgrade.confirmGeneric')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
