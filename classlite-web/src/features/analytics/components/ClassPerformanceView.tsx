/**
 * ClassPerformanceView — the `s46` class-performance route view (Story 8-2b,
 * Task 7, AC10-19). Reads `useParams().id` + `useClassPerformance(id)` — ONE
 * aggregate GET, so the three-state trilogy is: loading skeleton / whole-view
 * inline `role="alert"` + retry / 404 non-disclosure not-found (D4). Per-ZONE
 * states below that are EMPTY states (empty mistakes, empty at-risk) — there is
 * NO partial-failure surface (one query, Murat/AC22).
 *
 * Composes the 4-up null-safe stat row, the two net-new hand-built charts
 * (`BandTrendChart` + `SkillWeekHeatmap`, sharing the dense week axis), the
 * mistake rows (textual type + text trend label + `excludedSources` inline
 * note), the at-risk list, and the on-time zone. Every nullable value renders
 * "—" NEVER 0 (R-C); `targetBand: null` triggers the D11 fallback across the
 * heatmap (neutral ramp), the sparkline (no target line), the target tile ("—"),
 * and the "set a target" affordance.
 */
import type { ReactElement } from 'react'
import { useParams } from 'react-router'
import { useTranslation } from 'react-i18next'
import { ApiError } from '@/lib/api-fetch'
import { BandTrendChart } from '@/components/domain/BandTrendChart'
import { SkillWeekHeatmap } from '@/components/domain/SkillWeekHeatmap'
import { useClassPerformance } from '../api/useClassPerformance'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'
import { ClassAtRiskRow } from './ClassAtRiskRow'
import { MistakePatternRow } from './MistakePatternRow'

const NOT_FOUND_STATUS = 404

function StatTile({
  label,
  value,
  caption,
}: {
  label: string
  value: string
  caption?: string
}): ReactElement {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4">
      <span className="font-mono text-2xl leading-none text-[var(--cl-ink)]">
        {value}
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">{label}</span>
      {caption ? (
        <span className="text-[10px] text-[var(--cl-ink-soft)]">{caption}</span>
      ) : null}
    </div>
  )
}

export function ClassPerformanceView(): ReactElement {
  const { t, i18n } = useTranslation()
  const { id } = useParams()
  const query = useClassPerformance(id ?? '')

  if (query.isPending) {
    return (
      <div
        data-testid="analytics-class-skeleton"
        aria-busy="true"
        className="space-y-6"
      >
        <div className="h-8 w-64 animate-pulse rounded bg-slate-200" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
          <div className="h-24 animate-pulse rounded-xl bg-slate-200" />
        </div>
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
        <div className="h-40 animate-pulse rounded-2xl bg-slate-200" />
      </div>
    )
  }

  if (query.isError) {
    const notFound =
      query.error instanceof ApiError && query.error.status === NOT_FOUND_STATUS
    if (notFound) {
      return (
        <div
          data-testid="analytics-class-not-found"
          className="mx-auto flex max-w-md flex-col items-center gap-3 px-6 py-16 text-center"
        >
          <span aria-hidden="true" className="text-4xl">
            🔍
          </span>
          <p className="text-sm text-[var(--cl-ink-soft)]">
            {t('analytics.class.notFound')}
          </p>
        </div>
      )
    }
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4 text-sm text-[var(--cl-ink)]"
      >
        <p>{t('analytics.error.message')}</p>
        <button
          type="button"
          onClick={() => {
            void query.refetch()
          }}
          className="rounded-lg border border-[var(--cl-border)] px-3 py-1.5 text-sm font-medium hover:border-[var(--cl-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t('analytics.error.retry')}
        </button>
      </div>
    )
  }

  const data = query.data.data
  const {
    targetBand,
    cohortAvgBand,
    cohortAvgDelta,
    atRiskCount,
    onTimeSubmissionRate,
    hasWritingContent,
    bandOverTime,
    skillHeatmap,
    mistakePatterns,
    atRiskStudents,
    submissionRate,
  } = data
  const noTarget = targetBand === null

  return (
    <div className="flex flex-col gap-6">
      {/* Desktop-only-by-design (AC24): a non-blocking hint VISIBLE below the md
          breakpoint and CSS-hidden (`md:hidden` → display:none) at or above it.
          The node stays in the DOM at all widths — assert visibility, not
          DOM-absence, at ≥md. Wide charts sit in their own overflow-x-auto. */}
      <p
        data-testid="analytics-desktop-hint"
        className="rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-surface)] px-3 py-2 text-xs text-[var(--cl-ink-soft)] md:hidden"
      >
        {t('analytics.desktopHint')}
      </p>
      <header className="flex flex-col gap-1">
        <h1 className="text-xl font-semibold text-[var(--cl-ink)]">
          {data.className}
        </h1>
      </header>

      {/* 4-up stats — every nullable renders "—", NEVER 0 (R-C). */}
      <section
        data-testid="analytics-zone-stats"
        aria-label={t('analytics.zone.stats')}
        className="grid grid-cols-2 gap-4 md:grid-cols-4"
      >
        <StatTile
          label={t('analytics.stat.cohortAvg')}
          value={formatBandOrDash(cohortAvgBand)}
          caption={
            cohortAvgDelta !== null
              ? t('analytics.stat.delta', {
                  value: formatOrDash(cohortAvgDelta),
                })
              : undefined
          }
        />
        <StatTile
          label={t('analytics.stat.target')}
          value={formatBandOrDash(targetBand)}
        />
        <StatTile
          label={t('analytics.stat.atRisk')}
          value={new Intl.NumberFormat(i18n.language).format(atRiskCount)}
        />
        <StatTile
          label={t('analytics.stat.onTime')}
          value={formatOrDash(onTimeSubmissionRate, { style: 'percent' })}
        />
      </section>

      {noTarget ? (
        <div
          data-testid="analytics-no-target"
          className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-[var(--cl-border)] bg-[var(--cl-surface)] px-3 py-2 text-sm text-[var(--cl-ink-soft)]"
        >
          <span>{t('analytics.noTarget.headline')}</span>
          <span className="font-medium text-[var(--cl-ink)]">
            {t('analytics.noTarget.action')}
          </span>
        </div>
      ) : null}

      {/* Band-over-time trend. */}
      <section
        data-testid="analytics-zone-trend"
        aria-label={t('analytics.zone.trend')}
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-[var(--cl-ink)]">
          {t('analytics.zone.trend')}
        </h2>
        <BandTrendChart
          points={bandOverTime}
          weeks={skillHeatmap.weeks}
          targetBand={targetBand}
        />
      </section>

      {/* Writing-criteria × week heatmap (or the DR-D "no Writing content" copy). */}
      <section
        data-testid="analytics-zone-heatmap"
        aria-label={t('analytics.zone.heatmap')}
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-[var(--cl-ink)]">
          {t('analytics.zone.heatmap')}
        </h2>
        {hasWritingContent ? (
          <SkillWeekHeatmap heatmap={skillHeatmap} targetBand={targetBand} />
        ) : (
          <p
            data-testid="analytics-heatmap-no-writing"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t('analytics.heatmap.noWriting')}
          </p>
        )}
      </section>

      {/* Repetitive-mistake rows + the excluded-source inline info note. */}
      <section
        data-testid="analytics-zone-mistakes"
        aria-label={t('analytics.zone.mistakes')}
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-[var(--cl-ink)]">
          {t('analytics.zone.mistakes')}
        </h2>
        {mistakePatterns.excludedSources.length > 0 ? (
          <p
            data-testid="analytics-mistakes-excluded-note"
            className="mb-3 rounded-lg bg-[var(--cl-muted)] px-3 py-2 text-xs text-[var(--cl-ink-soft)]"
          >
            {t('analytics.mistakes.excludedNote')}
          </p>
        ) : null}
        {mistakePatterns.patterns.length === 0 ? (
          <p
            data-testid="analytics-mistakes-empty"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t('analytics.mistakes.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {mistakePatterns.patterns.map((pattern, index) => (
              <MistakePatternRow
                key={`${pattern.skillSource}-${pattern.criterion}-${pattern.type}-${index}`}
                pattern={pattern}
                index={index}
              />
            ))}
          </ul>
        )}
      </section>

      {/* At-risk students. */}
      <section
        data-testid="analytics-zone-atrisk"
        aria-label={t('analytics.zone.atRisk')}
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-[var(--cl-ink)]">
          {t('analytics.zone.atRisk')}
        </h2>
        {atRiskStudents.length === 0 ? (
          <p
            data-testid="analytics-atrisk-empty"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t('analytics.atRisk.empty')}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {atRiskStudents.map((student) => (
              <ClassAtRiskRow key={student.studentId} student={student} />
            ))}
          </ul>
        )}
      </section>

      {/* On-time submission rate. */}
      <section
        data-testid="analytics-zone-ontime"
        aria-label={t('analytics.zone.onTime')}
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-1 text-sm font-semibold text-[var(--cl-ink)]">
          {t('analytics.zone.onTime')}
        </h2>
        <p className="font-mono text-2xl text-[var(--cl-ink)]">
          {formatOrDash(submissionRate.rate, { style: 'percent' })}
        </p>
        <p className="text-xs text-[var(--cl-ink-soft)]">
          {t('analytics.onTime.detail', {
            onTime: submissionRate.onTimeCount,
            total: submissionRate.totalDue,
          })}
        </p>
      </section>
    </div>
  )
}
