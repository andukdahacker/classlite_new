/**
 * AtRiskRow — one at-risk student row, shared by the teacher at-risk rail and
 * the owner needs-attention card (Story 8-1b, D6). Shows the name, attendance
 * ("—" when null, NEVER "0%"), overall band ("—" when null), the server-sent
 * `reasons[]` slugs mapped to i18n (`dashboard.atRisk.reason.*` — the FE never
 * guesses the reason text), and a `PerfPill tone="at-risk"`.
 *
 * `perfToneFromStatus` is deliberately NOT used: the dashboard sends reason
 * slugs, not an `AtRiskStatus`, so the tone is passed directly (D6). `pendingCount`
 * (the student's pending assignments) is rendered as a compact meta stat (8-1b D13
 * co-finalized).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { PerfPill } from '@/components/domain/PerfPill'

type DashboardAtRiskItem = components['schemas']['DashboardAtRiskItem']

const PERCENT = 100
const EM_DASH = '—'

export interface AtRiskRowProps {
  item: DashboardAtRiskItem
}

export function AtRiskRow({ item }: AtRiskRowProps): ReactElement {
  const { t } = useTranslation()
  const attendance =
    item.attendanceRate == null
      ? EM_DASH
      : `${Math.round(item.attendanceRate * PERCENT)}%`
  const band = item.overallBand == null ? EM_DASH : String(item.overallBand)

  return (
    <li className="flex flex-col gap-1 rounded-lg border border-[var(--cl-border)] p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-[var(--cl-ink)]">{item.name}</span>
        <PerfPill tone="at-risk" />
      </div>
      <div className="flex items-center gap-3 text-xs text-[var(--cl-ink-soft)]">
        <span className="font-mono">{attendance}</span>
        <span className="font-mono">
          <span lang="en">{band}</span>
        </span>
        <span>{t('dashboard.atRisk.pending', { count: item.pendingCount })}</span>
      </div>
      <ul className="flex flex-wrap gap-1">
        {item.reasons.map((reason) => (
          <li
            key={reason}
            className="rounded-full bg-[var(--cl-tint-red)] px-2 py-0.5 text-xs text-[var(--cl-red)]"
          >
            {t(`dashboard.atRisk.reason.${reason}`, { defaultValue: reason })}
          </li>
        ))}
      </ul>
    </li>
  )
}
