/**
 * MistakePatternRow — one repetitive-mistake / strength row (Story 8-2b, Task 7,
 * AC17 / D16a; extended by Story 8-3b Task 6 / D-COFINAL). Carries an EXPLICIT
 * TEXTUAL type — "Recurring mistake" (error / suggestion) vs "Strength" (the calm
 * `type='praise'` variant) — plus a TEXT trend label ("improving"/"worsening"/
 * "stable"), NEVER an arrow glyph or colour alone (WCAG 1.4.1). Skill tag +
 * frequency round it out; the affected-student count renders ONLY when present
 * (null on /me and suppressed on the single-student detail view — Winston #7).
 *
 * D-COFINAL: the skill label falls back to `questionType` when `criterion === ''`
 * (auto_graded reading/listening rows carry the question type there); human_comment
 * rows may reveal a mined `exampleQuote` + `exampleNote`. Rows render in the
 * server's deterministic order (the parent does NOT re-sort).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { patternLabel, type MistakePattern } from '../lib/patternLabels'

export interface MistakePatternRowProps {
  pattern: MistakePattern
  index: number
}

export function MistakePatternRow({
  pattern,
  index,
}: MistakePatternRowProps): ReactElement {
  const { t } = useTranslation()
  const isStrength = pattern.type === 'praise'
  const typeKey = isStrength
    ? 'analytics.mistakes.type.strength'
    : 'analytics.mistakes.type.recurring'

  // D-COFINAL: the skill label is the questionType for auto_graded rows and the
  // IELTS criterion for human_comment rows — routed through the shared patternLabel
  // helper so the split (keyed off patternSource, code-review P2) never drifts.
  const label = patternLabel(t, pattern)

  return (
    <li
      data-testid={`analytics-mistake-row-${index}`}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[var(--cl-border)] bg-[var(--cl-surface)] p-3"
    >
      <span
        className={
          isStrength
            ? 'rounded-full bg-[color:var(--cl-tint-green)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-green)]'
            : 'rounded-full bg-[color:var(--cl-tint-gold)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-amber)]'
        }
      >
        {t(typeKey)}
      </span>
      <span className="text-sm text-[var(--cl-ink)]">
        <span>{t(`analytics.skillSource.${pattern.skillSource}`)}</span> ·{' '}
        <span lang="en">{label}</span>
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('analytics.mistakes.frequency', { count: pattern.instanceCount })}
      </span>
      {pattern.affectedStudentCount !== null ? (
        <span className="text-xs text-[var(--cl-ink-soft)]">
          {t('analytics.mistakes.affected', {
            count: pattern.affectedStudentCount,
          })}
        </span>
      ) : null}
      {/* TEXT trend label — never an arrow glyph or colour alone (1.4.1). */}
      <span className="text-xs font-medium text-[var(--cl-ink-soft)]">
        {t(`analytics.mistakes.trend.${pattern.trend}`)}
      </span>
      {pattern.exampleQuote ? (
        <p
          data-testid={`analytics-mistake-quote-${index}`}
          className="w-full text-xs italic text-[var(--cl-ink-soft)]"
        >
          {`“${pattern.exampleQuote}”`}
        </p>
      ) : null}
      {pattern.exampleNote ? (
        <p className="w-full text-xs text-[var(--cl-ink-soft)]">
          {pattern.exampleNote}
        </p>
      ) : null}
    </li>
  )
}
