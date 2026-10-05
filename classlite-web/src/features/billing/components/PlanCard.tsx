/**
 * PlanCard — one tier card in the plan picker (Story 9-1b; CTAs rewired in 9-2b,
 * Task 9 / AC1/AC4).
 *
 * Renders the tier's feature limits, the active-cycle VND price + server VAT split
 * (verbatim — never re-derived, D25), and a real plan-change CTA relative to the
 * caller's current tier:
 *   - current tier       → a "Current plan" badge, no CTA;
 *   - a higher tier      → "Upgrade to {tier}" → opens the s71 UpgradeModal (`onUpgrade`);
 *   - a lower tier       → "Downgrade to {tier}" → opens the downgrade-confirm
 *                          modal (`onDowngrade`).
 * The 9-1b `mailto:` "Talk to us" placeholder is gone — purchase is live.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDataSize } from '@/lib/formatDataSize'
import { Button } from '@/components/ui/button'
import type { components } from '@/lib/api/client'
import type { PlanCatalogEntry } from '../api/useBillingPlans'
import { formatVnd } from '../lib/formatVnd'
import { planDisplayName } from '../lib/planDisplay'

type PlanId = components['schemas']['BillingSummary']['plan']
type UpgradeTarget = components['schemas']['BillingProrationPreview']['targetPlan']

export interface PlanCardProps {
  entry: PlanCatalogEntry
  /** Show annual price + VAT split when true, monthly when false. */
  annual: boolean
  /** The caller's current plan — decides upgrade vs downgrade vs current. */
  currentPlan: PlanId
  /** Open the upgrade modal for a strictly-higher target tier. */
  onUpgrade: (target: UpgradeTarget) => void
  /** Open the downgrade-confirm modal for a strictly-lower target tier. */
  onDowngrade: (target: PlanId) => void
}

const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, studio: 2 }

function limitLabel(value: number | null, unlimited: string): string {
  return value === null ? unlimited : String(value)
}

export function PlanCard({
  entry,
  annual,
  currentPlan,
  onUpgrade,
  onDowngrade,
}: PlanCardProps): ReactElement {
  const { t, i18n } = useTranslation()
  const tier = planDisplayName(entry.plan)
  const isPaid = entry.priceMonthlyVnd > 0
  const isCurrent = entry.plan === currentPlan
  const isHigher = PLAN_RANK[entry.plan] > PLAN_RANK[currentPlan]
  const unlimited = t('billing.meter.unlimited')

  const price = annual ? entry.priceAnnualVnd : entry.priceMonthlyVnd
  const subtotal = annual ? entry.vat.annualSubtotal : entry.vat.monthlySubtotal
  const vat = annual ? entry.vat.annualVat : entry.vat.monthlyVat
  const periodKey = annual ? 'billing.picker.perYear' : 'billing.picker.perMonth'

  return (
    <div
      data-testid={`plan-card-${entry.plan}`}
      className={`flex flex-col gap-3 rounded-xl border p-4 ${
        isCurrent
          ? 'border-[color:var(--cl-accent)] ring-1 ring-[color:var(--cl-accent)]'
          : 'border-slate-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <h2 className="font-fraunces text-lg text-slate-900">{tier}</h2>
        {isCurrent ? (
          <span
            className="rounded-full bg-[color:var(--cl-tint-accent)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-accent)]"
            data-testid={`plan-card-current-${entry.plan}`}
          >
            {t('billing.picker.currentPlan')}
          </span>
        ) : null}
      </div>

      <div>
        <p className="text-2xl font-semibold tabular-nums text-slate-900">
          {formatVnd(price)}
          <span className="ml-1 text-sm font-normal text-slate-500">
            {t(periodKey)}
          </span>
        </p>
        {isPaid ? (
          <>
            <p className="mt-1 text-xs text-slate-500 tabular-nums">
              {t('billing.picker.vatSplit', {
                subtotal: formatVnd(subtotal),
                vat: formatVnd(vat),
              })}
            </p>
            <p className="text-xs text-slate-400">{t('billing.vatCaption')}</p>
          </>
        ) : null}
      </div>

      <ul className="flex flex-col gap-1 text-sm text-slate-600">
        <li>{t('billing.picker.limits.teachers', { value: limitLabel(entry.limits.teachers, unlimited) })}</li>
        <li>{t('billing.picker.limits.classes', { value: limitLabel(entry.limits.classes, unlimited) })}</li>
        <li>{t('billing.picker.limits.studentsPerClass', { value: limitLabel(entry.limits.studentsPerClass, unlimited) })}</li>
        <li>{t('billing.picker.limits.aiCredits', { value: limitLabel(entry.limits.aiCreditsPerMonth, unlimited) })}</li>
        <li>{t('billing.picker.limits.storage', { value: formatDataSize(entry.limits.storageBytes, i18n.language) })}</li>
      </ul>

      {isCurrent ? null : isHigher ? (
        <Button
          className="mt-auto w-fit"
          data-testid={`plan-card-upgrade-${entry.plan}`}
          onClick={() => onUpgrade(entry.plan as UpgradeTarget)}
        >
          {t('billing.action.upgradeTo', { tier })}
        </Button>
      ) : (
        <Button
          variant="outline"
          className="mt-auto w-fit"
          data-testid={`plan-card-downgrade-${entry.plan}`}
          onClick={() => onDowngrade(entry.plan)}
        >
          {t('billing.action.downgradeTo', { tier })}
        </Button>
      )}
    </div>
  )
}
