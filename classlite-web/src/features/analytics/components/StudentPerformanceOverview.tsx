/**
 * StudentPerformanceOverview — the Overview tab for BOTH the teacher `s47` detail
 * and the student `s37` view (Story 8-3b, Task 2, AC5-7). ONE presentational
 * component keyed off `perf.framing` (D5) — never the route/role:
 *
 *  - Overall band via the reused `BandScoreChart`. On `framing==='student'` the
 *    vs-target delta is SUPPRESSED (targetBand passed null) so no red ▼ renders
 *    (D-SOFTEN — RED is baked into BandScoreChart); the target is shown instead as
 *    a calm "your goal" aspiration pill.
 *  - Per-skill weekly `BandTrendChart` (null-gap; the target line is muted, never
 *    red, so it is safe on both framings).
 *  - Per-skill breakdown rows; the cohort `classAvgBand` renders ONLY on
 *    `framing==='teacher'` AND when non-null (FR-50 — the fail-safe default is
 *    teacher-only-on-explicit-teacher; a student never surfaces a peer value even
 *    if the wire leaks one — AC19a defence-in-depth).
 *  - A submission-stats strip via `submissionRate.rate` (there is NO onTimeRate
 *    field). Every nullable value routes through formatOrDash/formatBandOrDash —
 *    null → localized "—", NEVER 0 (R-B).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { BandScoreChart } from '@/components/domain/BandScoreChart'
import { BandTrendChart } from '@/components/domain/BandTrendChart'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'
import type { StudentPerformance } from '../api/useStudentPerformance'

export interface StudentPerformanceOverviewProps {
  perf: StudentPerformance
}

function StatTile({
  label,
  value,
  testId,
}: {
  label: string
  value: string
  testId?: string
}): ReactElement {
  return (
    <div
      data-testid={testId}
      className="flex flex-col gap-1 rounded-xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
    >
      <span className="font-mono text-2xl leading-none text-[var(--cl-ink)]">
        {value}
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">{label}</span>
    </div>
  )
}

export function StudentPerformanceOverview({
  perf,
}: StudentPerformanceOverviewProps): ReactElement {
  const { t, i18n } = useTranslation()
  // Fail-safe (Winston #6): peer/red treatments render ONLY on an explicit
  // teacher framing — a forgotten/absent framing degrades toward LESS softening
  // visible (student-safe), never a peer/red leak.
  const isTeacher = perf.framing === 'teacher'

  const bands = perf.skillBreakdown
    .map((s) => s.overallBand)
    .filter((b): b is number => b !== null)
  const overallBand = bands.length
    ? bands.reduce((sum, b) => sum + b, 0) / bands.length
    : null

  const num = (n: number): string => new Intl.NumberFormat(i18n.language).format(n)
  const stats = perf.submissionStats

  // AC12 mixed-grain ghosted-frame (code-review P7): each Overview zone dims on its
  // OWN hasData flag — independent of the global gradedSubmissionCount<3 banner, so a
  // student with graded work but (say) no band history still gets a per-zone empty
  // state, not a bare labelled void. A MISSING key defaults to shown (never hide
  // content we might have).
  const zoneDimmed = (key: string): boolean => stats.hasData[key] === false
  const zoneEmptyKey = isTeacher
    ? 'analytics.studentPerformance.overview.zoneEmpty'
    : 'analytics.myPerformance.overview.zoneEmpty'
  // AC13 / D-MOBILE (code-review P8): on the TEACHER detail the dense per-skill trend
  // charts are HIDDEN on phone widths so the md:hidden desktop hint truly REPLACES
  // them (a squished chart is the degraded screen §11.1 forbids). The student glance
  // keeps its charts in overflow-x-auto — never hidden. The token also carries the
  // section's display (flex), so `hidden` and `flex` never both apply.
  const denseDisplayClass = isTeacher ? 'hidden md:flex' : 'flex'

  return (
    <div className="flex flex-col gap-6">
      {/* Overall band — the vs-target delta is teacher-only (no red on student). */}
      <section
        data-testid="student-perf-overall"
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <BandScoreChart
          overallBand={overallBand}
          currentVsFirstDelta={null}
          targetBand={isTeacher ? perf.targetBand : null}
        />
        {/* targetBand as an aspiration on BOTH views (never a "you're short" gap). */}
        {perf.targetBand !== null ? (
          <span
            data-testid="student-perf-goal"
            className="mt-3 inline-block rounded-full bg-[var(--cl-muted)] px-3 py-1 text-xs font-medium text-[var(--cl-ink-soft)]"
          >
            {isTeacher
              ? t('analytics.studentPerformance.overview.targetGoal', {
                  band: formatBandOrDash(perf.targetBand),
                })
              : t('analytics.myPerformance.overview.goal', {
                  band: formatBandOrDash(perf.targetBand),
                })}
          </span>
        ) : null}
      </section>

      {/* Per-skill breakdown — cohort classAvgBand is teacher-only (FR-50). */}
      <section
        data-testid="student-perf-breakdown"
        aria-label={
          isTeacher
            ? t('analytics.studentPerformance.overview.breakdownZone')
            : t('analytics.myPerformance.overview.breakdownZone')
        }
        className="rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4"
      >
        <h2 className="mb-3 text-sm font-semibold text-[var(--cl-ink)]">
          {isTeacher
            ? t('analytics.studentPerformance.overview.breakdownZone')
            : t('analytics.myPerformance.overview.breakdownZone')}
        </h2>
        {zoneDimmed('skillBreakdown') ? (
          <p
            data-testid="student-perf-breakdown-empty"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t(zoneEmptyKey)}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {perf.skillBreakdown.map((sb) => (
              <li
                key={sb.skill}
                data-testid={`student-perf-skill-${sb.skill}`}
                className="flex flex-wrap items-baseline gap-3"
              >
              <span className="text-sm text-[var(--cl-ink)]" lang="en">
                {t(`people.student.skill.${sb.skill}`)}
              </span>
              <span className="font-mono text-sm text-[var(--cl-ink)]">
                {formatBandOrDash(sb.overallBand)}
              </span>
              {isTeacher && sb.classAvgBand !== null ? (
                <span
                  data-testid={`student-perf-classavg-${sb.skill}`}
                  className="text-xs text-[var(--cl-ink-soft)]"
                >
                  {t('analytics.studentPerformance.overview.classAvg', {
                    band: formatBandOrDash(sb.classAvgBand),
                  })}
                </span>
              ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Per-skill weekly band-progression trend. */}
      <section
        data-testid="student-perf-trend"
        aria-label={
          isTeacher
            ? t('analytics.studentPerformance.overview.trendZone')
            : t('analytics.myPerformance.overview.trendZone')
        }
        className={`${denseDisplayClass} flex-col gap-4 rounded-2xl border border-[var(--cl-border)] bg-[var(--cl-surface)] p-4`}
      >
        <h2 className="text-sm font-semibold text-[var(--cl-ink)]">
          {isTeacher
            ? t('analytics.studentPerformance.overview.trendZone')
            : t('analytics.myPerformance.overview.trendZone')}
        </h2>
        {zoneDimmed('bandProgression') ? (
          <p
            data-testid="student-perf-trend-empty"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t(zoneEmptyKey)}
          </p>
        ) : (
          perf.bandProgression.map((series) => (
            <div key={series.skill} className="overflow-x-auto">
              <h3 className="mb-1 text-xs font-medium text-[var(--cl-ink-soft)]" lang="en">
                {t(`people.student.skill.${series.skill}`)}
              </h3>
              <BandTrendChart
                points={series.points}
                weeks={series.points.map((p) => p.weekStart)}
                targetBand={perf.targetBand}
              />
            </div>
          ))
        )}
      </section>

      {/* Submission stats — via submissionRate.rate (NO onTimeRate field). */}
      <section
        data-testid="student-perf-stats"
        aria-label={
          isTeacher
            ? t('analytics.studentPerformance.overview.statsZone')
            : t('analytics.myPerformance.overview.statsZone')
        }
        className="flex flex-col gap-4"
      >
        {zoneDimmed('submissionStats') ? (
          <p
            data-testid="student-perf-stats-empty"
            className="text-sm text-[var(--cl-ink-soft)]"
          >
            {t(zoneEmptyKey)}
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
            {/* Graded count — its own purpose-built label (code-review P5), not the
                generic zone title. */}
            <StatTile
              label={t('analytics.studentPerformance.stat.graded', {
                count: stats.gradedSubmissionCount,
              })}
              value={num(stats.gradedSubmissionCount)}
              testId="student-perf-stat-graded"
            />
            <StatTile
              label={t('analytics.studentPerformance.stat.total', {
                count: stats.totalSubmissionCount,
              })}
              value={num(stats.totalSubmissionCount)}
            />
            <StatTile
              label={t('analytics.studentPerformance.stat.onTime', { value: '' })}
              value={formatOrDash(stats.submissionRate.rate, { style: 'percent' })}
            />
            {/* Praise / error pin counts are teacher-oriented framing — omitted on
                the softened student view (no "error notes" language, FR-50). */}
            {isTeacher ? (
              <>
                <StatTile
                  label={t('analytics.studentPerformance.stat.praisePins', {
                    count: stats.praisePinCount,
                  })}
                  value={num(stats.praisePinCount)}
                />
                <StatTile
                  label={t('analytics.studentPerformance.stat.errorPins', {
                    count: stats.errorPinCount,
                  })}
                  value={num(stats.errorPinCount)}
                />
              </>
            ) : null}
          </div>
        )}
      </section>
    </div>
  )
}
