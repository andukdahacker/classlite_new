/**
 * StudentMistakeRow — the ONE shared, framing-aware expandable mistake/pattern row
 * behind BOTH student-performance lists (Story 8-3b, D-SOFTEN; consolidated at
 * code-review 2026-09-23 — the `<details>`/quote/note/label markup previously lived
 * in three places and risked drifting). `framing` selects the i18n namespace, the
 * type-badge tone, the trend treatment, and the testid prefix:
 *   - `framing==='teacher'` (`s47` Mistakes): a worsening trend MAY carry a danger
 *     tone + the quote-less auto-graded hint; testids `student-mistake-*`.
 *   - `framing==='student'` (`s37` Focus areas): a worsening trend is NEUTRALIZED to
 *     a calm focus-area label — NEVER red, no ▼ glyph (§6.1:346) — no hint; testids
 *     `student-pattern-*`.
 * The auto_graded vs human_comment split keys off `patternSource` (never
 * `criterion===''`) and the label routes through the shared `patternLabel` helper.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { patternLabel, type MistakePattern } from '../lib/patternLabels'

export interface StudentMistakeRowProps {
  pattern: MistakePattern
  framing: 'teacher' | 'student'
  index: number
}

// Teacher-only trend tones — a worsening trend MAY read danger-red here (§1.4.1: the
// TEXT label always carries the meaning, colour is redundant). Never used on student.
const TEACHER_TREND_TONE: Record<string, string> = {
  worsening: 'text-[color:var(--cl-red)]',
  improving: 'text-[color:var(--cl-green)]',
  stable: 'text-[var(--cl-ink-soft)]',
}

// Student trend labels — a worsening trend is a neutral focus area, never a decline
// signal (§6.1:346). No tone token ever matches danger/at-risk/red.
const STUDENT_TREND_LABEL: Record<string, string> = {
  improving: 'analytics.myPerformance.patterns.improvingTrend',
  worsening: 'analytics.myPerformance.patterns.focusTrend',
  stable: 'analytics.myPerformance.patterns.stableTrend',
}

export function StudentMistakeRow({
  pattern,
  framing,
  index,
}: StudentMistakeRowProps): ReactElement {
  const { t } = useTranslation()
  const isTeacher = framing === 'teacher'
  const isStrength = pattern.type === 'praise'
  const isAutoGraded = pattern.patternSource === 'auto_graded'
  const rowId = isTeacher ? 'student-mistake' : 'student-pattern'
  const ns = isTeacher
    ? 'analytics.studentPerformance.mistakes'
    : 'analytics.myPerformance.patterns'

  const typeLabel = isStrength
    ? t(`${ns}.strengthType`)
    : t(isTeacher ? `${ns}.recurringType` : `${ns}.focusType`)
  const typeBadgeClass = isStrength
    ? 'rounded-full bg-[color:var(--cl-tint-green)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-green)]'
    : isTeacher
      ? 'rounded-full bg-[color:var(--cl-tint-gold)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-amber)]'
      : 'rounded-full bg-[var(--cl-muted)] px-2 py-0.5 text-xs font-medium text-[var(--cl-ink-soft)]'

  const trendLabel = isTeacher
    ? t(`analytics.studentPerformance.trend.${pattern.trend}`)
    : t(
        STUDENT_TREND_LABEL[pattern.trend] ??
          'analytics.myPerformance.patterns.stableTrend',
      )
  const trendClass = isTeacher
    ? `text-xs font-medium ${TEACHER_TREND_TONE[pattern.trend] ?? 'text-[var(--cl-ink-soft)]'}`
    : 'text-xs font-medium text-[var(--cl-ink-soft)]'

  return (
    <details
      data-testid={`${rowId}-row-${index}`}
      className="rounded-lg border border-[var(--cl-border)] bg-[var(--cl-surface)] p-3"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-3">
        <span className={typeBadgeClass}>{typeLabel}</span>
        <span className="text-sm text-[var(--cl-ink)]">
          <span>{t(`analytics.skillSource.${pattern.skillSource}`)}</span> ·{' '}
          <span lang="en">{patternLabel(t, pattern)}</span>
        </span>
        <span className="text-xs text-[var(--cl-ink-soft)]">
          {t(`${ns}.frequency`, { count: pattern.instanceCount })}
        </span>
        {/* TEXT trend label — never an arrow glyph or colour alone (§1.4.1). */}
        <span
          data-testid={`${rowId}-trend-${index}`}
          className={trendClass}
        >
          {trendLabel}
        </span>
      </summary>
      <div className="mt-2 flex flex-col gap-1 border-t border-[var(--cl-border)] pt-2">
        {/* Auto-graded rows are quote-less → a warm generic hint (teacher only). */}
        {isTeacher && isAutoGraded ? (
          <p className="text-xs text-[var(--cl-ink-soft)]">
            {t('analytics.studentPerformance.mistakes.autoGradedHint')}
          </p>
        ) : null}
        {pattern.exampleQuote ? (
          <p
            data-testid={`${rowId}-quote-${index}`}
            className="text-xs italic text-[var(--cl-ink)]"
          >
            <span className="not-italic text-[var(--cl-ink-soft)]">
              {t(`${ns}.exampleLabel`)}:{' '}
            </span>
            {`“${pattern.exampleQuote}”`}
          </p>
        ) : null}
        {pattern.exampleNote ? (
          <p className="text-xs text-[var(--cl-ink-soft)]">
            {t(`${ns}.noteLabel`)}: {pattern.exampleNote}
          </p>
        ) : null}
      </div>
    </details>
  )
}
