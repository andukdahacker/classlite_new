/**
 * MistakePatternRow — one repetitive-mistake / strength row (Story 8-2b, Task 7,
 * AC17 / D16a). Carries an EXPLICIT TEXTUAL type — "Recurring mistake" (error /
 * suggestion) vs "Strength" (the calm `type='praise'` variant) — plus a TEXT
 * trend label ("improving"/"worsening"/"stable"), NEVER an arrow glyph or colour
 * alone (WCAG 1.4.1). Skill tag + frequency + affected-student count round it
 * out. Rows render in the server's deterministic order (the parent does NOT
 * re-sort).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'

type MistakePattern = components['schemas']['MistakePattern']

export interface MistakePatternRowProps {
  pattern: MistakePattern
  index: number
}

const CRITERION_LABEL_KEY: Record<string, string> = {
  taskResponse: 'criterion.taskResponse',
  coherenceCohesion: 'criterion.coherenceCohesion',
  lexicalResource: 'criterion.lexicalResource',
  grammaticalRange: 'criterion.grammaticalRange',
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
        {t(`analytics.skillSource.${pattern.skillSource}`)} ·{' '}
        <span lang="en">
          {t(CRITERION_LABEL_KEY[pattern.criterion] ?? pattern.criterion)}
        </span>
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('analytics.mistakes.frequency', { count: pattern.instanceCount })}
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('analytics.mistakes.affected', { count: pattern.affectedStudentCount })}
      </span>
      {/* TEXT trend label — never an arrow glyph or colour alone (1.4.1). */}
      <span className="text-xs font-medium text-[var(--cl-ink-soft)]">
        {t(`analytics.mistakes.trend.${pattern.trend}`)}
      </span>
    </li>
  )
}
