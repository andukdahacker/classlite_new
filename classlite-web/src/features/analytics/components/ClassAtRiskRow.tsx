/**
 * ClassAtRiskRow — one at-risk student row in the class-performance view (Story
 * 8-2b, Task 7, AC19 / D9). Reuses the 7-2b `PerfPill tone="at-risk"` and the
 * EXISTING `dashboard.atRisk.reason.*` keys (the `AnalyticsAtRiskItem.reasons`
 * enum matches those keys exactly) rather than duplicating strings. Null-safe:
 * attendanceRate / overallBand render "—" on null via the shared helper.
 *
 * NOTE — `AtRiskRow` (dashboard) consumes `DashboardAtRiskItem`; the analytics
 * item shape differs (`AnalyticsAtRiskItem`), so this is a thin analytics-local
 * row, not a reuse of that component (D9).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PerfPill } from '@/components/domain/PerfPill'
import type { components } from '@/lib/api/client'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'

type AnalyticsAtRiskItem = components['schemas']['AnalyticsAtRiskItem']

export interface ClassAtRiskRowProps {
  student: AnalyticsAtRiskItem
}

export function ClassAtRiskRow({ student }: ClassAtRiskRowProps): ReactElement {
  const { t } = useTranslation()
  return (
    <li
      data-testid={`analytics-atrisk-row-${student.studentId}`}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--cl-border)] bg-[var(--cl-surface)] p-3"
    >
      <PerfPill tone="at-risk" />
      <span className="font-medium text-[var(--cl-ink)]">{student.name}</span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('analytics.atRisk.attendance', {
          value: formatOrDash(student.attendanceRate, { style: 'percent' }),
        })}
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('analytics.atRisk.band', { value: formatBandOrDash(student.overallBand) })}
      </span>
      <span className="flex flex-wrap gap-1">
        {student.reasons.map((reason) => (
          <span
            key={reason}
            className="rounded-full bg-[color:var(--cl-tint-red)] px-2 py-0.5 text-xs text-[color:var(--cl-red)]"
          >
            {t(`dashboard.atRisk.reason.${reason}`)}
          </span>
        ))}
      </span>
    </li>
  )
}
