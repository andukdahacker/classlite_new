/**
 * ClassSummaryCard — one analyzable-class card on the analytics home (Story
 * 8-2b, s45 / AC6 / AC9). A clickable card that navigates to
 * `/analytics/class/:id`, showing the class name + null-safe mini-stats
 * (studentCount, avgBand, atRiskCount, onTimeRate). Every band/rate goes through
 * the single `formatBandOrDash` / `formatOrDash` helper so a `null` renders "—",
 * NEVER "0" (R-C / D13).
 *
 * The at-risk stat renders ONLY when `atRiskCount > 0` — a zero at-risk count is
 * a GOOD state (calm "on track" copy), not a red "0" badge, and rendering it as
 * a bare "0" would misread as an alert. Domain-free feature component (FW-7).
 */
import type { ReactElement } from 'react'
import { useNavigate } from 'react-router'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'

type AnalyticsClassSummary = components['schemas']['AnalyticsClassSummary']

export interface ClassSummaryCardProps {
  summary: AnalyticsClassSummary
}

export function ClassSummaryCard({
  summary,
}: ClassSummaryCardProps): ReactElement {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const count = new Intl.NumberFormat(i18n.language).format(summary.studentCount)

  return (
    <button
      type="button"
      data-testid={`analytics-class-card-${summary.classId}`}
      onClick={() => navigate(`/analytics/class/${summary.classId}`)}
      className="flex flex-col items-start gap-3 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4 text-left transition-colors hover:border-[var(--cl-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span className="text-base font-semibold text-[var(--cl-ink)]">
        {summary.className}
      </span>
      <dl className="grid w-full grid-cols-3 gap-2">
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--cl-ink-soft)]">
            {t('analytics.summary.students')}
          </dt>
          <dd className="font-mono text-sm text-[var(--cl-ink)]">{count}</dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--cl-ink-soft)]">
            {t('analytics.summary.avgBand')}
          </dt>
          <dd className="font-mono text-sm text-[var(--cl-ink)]">
            {formatBandOrDash(summary.avgBand)}
          </dd>
        </div>
        <div className="flex flex-col">
          <dt className="text-xs text-[var(--cl-ink-soft)]">
            {t('analytics.summary.onTime')}
          </dt>
          <dd className="font-mono text-sm text-[var(--cl-ink)]">
            {formatOrDash(summary.onTimeRate, { style: 'percent' })}
          </dd>
        </div>
      </dl>
      {summary.atRiskCount > 0 ? (
        <span className="rounded-full bg-[color:var(--cl-tint-red)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-red)]">
          {t('analytics.summary.atRisk', { count: summary.atRiskCount })}
        </span>
      ) : (
        <span className="text-xs text-[var(--cl-ink-soft)]">
          {t('analytics.summary.onTrack')}
        </span>
      )}
    </button>
  )
}
