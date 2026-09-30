/**
 * PlanCard — one tier card in the plan picker (Story 9-1b, AC3/AC5/D-9-1b-1).
 *
 * Renders the tier's feature limits, the active-cycle VND price + server VAT
 * split (verbatim — never re-derived, D25), and an honest CTA:
 *   - current tier  → a "Current plan" badge, CTA neutralized;
 *   - other tiers   → a "Talk to us about {tier}" `mailto:` link (no "Upgrade"
 *                     verb — the purchase flow is 9.2, D-9-1b-1).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDataSize } from '@/lib/formatDataSize'
import type { PlanCatalogEntry } from '../api/useBillingPlans'
import { formatVnd } from '../lib/formatVnd'
import { buildTalkToUsMailto, planDisplayName } from '../lib/planDisplay'

export interface PlanCardProps {
  entry: PlanCatalogEntry
  /** Show annual price + VAT split when true, monthly when false. */
  annual: boolean
  /** True when this tier is the caller's current plan. */
  isCurrent: boolean
}

function limitLabel(value: number | null, unlimited: string): string {
  return value === null ? unlimited : String(value)
}

export function PlanCard({ entry, annual, isCurrent }: PlanCardProps): ReactElement {
  const { t, i18n } = useTranslation()
  const tier = planDisplayName(entry.plan)
  const isPaid = entry.priceMonthlyVnd > 0
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

      {isCurrent ? null : (
        <a
          href={buildTalkToUsMailto(entry.plan)}
          className="mt-auto inline-flex w-fit items-center rounded-md border border-[color:var(--cl-accent)] px-3 py-1.5 text-sm font-medium text-[color:var(--cl-accent)]"
        >
          {t('billing.picker.talkToUs', { tier })}
        </a>
      )}
    </div>
  )
}
