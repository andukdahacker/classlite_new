/**
 * StudentMistakesList — the teacher `s47` Mistakes tab (Story 8-3b, Task 3,
 * AC8-10). Skill-filterable repetitive-mistake rows across all four skills; each
 * row carries an EXPLICIT textual type ("Recurring mistake" / "Strength"), a TEXT
 * trend label (never a glyph/colour alone, §1.4.1), and an expandable body that
 * reveals the mined `exampleQuote` + teacher `exampleNote` (auto_graded rows are
 * quote-less → warm generic copy). `affectedStudentCount` is SUPPRESSED — it is
 * trivially 1 on a single-student detail view (Winston #7). The worsening trend
 * MAY carry a danger tone here (teacher surface); the student surface
 * (`StudentPatternsList`) never does (D-SOFTEN).
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SKILL_SOURCES,
  type MistakePattern,
  type SkillSource,
} from '../lib/patternLabels'
import { StudentMistakeRow } from './StudentMistakeRow'
import { patternRowKey } from '../lib/patternRowKey'

export interface StudentMistakesListProps {
  patterns: MistakePattern[]
}

type Filter = SkillSource | 'all'

export function StudentMistakesList({
  patterns,
}: StudentMistakesListProps): ReactElement {
  const { t } = useTranslation()
  const [filter, setFilter] = useState<Filter>('all')

  const presentSkills = useMemo(
    () => SKILL_SOURCES.filter((s) => patterns.some((p) => p.skillSource === s)),
    [patterns],
  )
  const visible = useMemo(
    () => (filter === 'all' ? patterns : patterns.filter((p) => p.skillSource === filter)),
    [patterns, filter],
  )

  return (
    <div className="flex flex-col gap-4" data-testid="student-mistakes-list">
      {/* Skill filter (AC10). */}
      <div
        role="group"
        aria-label={t('analytics.studentPerformance.mistakes.filterLabel')}
        className="flex flex-wrap gap-2"
      >
        {(['all', ...presentSkills] as Filter[]).map((f) => (
          <button
            key={f}
            type="button"
            data-testid={`student-mistakes-filter-${f}`}
            aria-pressed={filter === f}
            onClick={() => setFilter(f)}
            className={
              filter === f
                ? 'rounded-full bg-[var(--cl-ink)] px-3 py-1 text-xs font-medium text-[var(--cl-paper)]'
                : 'rounded-full border border-[var(--cl-border)] px-3 py-1 text-xs text-[var(--cl-ink-soft)] hover:border-[var(--cl-ink-soft)]'
            }
          >
            {f === 'all'
              ? t('analytics.studentPerformance.mistakes.filter.all')
              : t(`analytics.skillSource.${f}`)}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <p
          data-testid="student-mistakes-empty"
          className="text-sm text-[var(--cl-ink-soft)]"
        >
          {t('analytics.studentPerformance.mistakes.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((pattern, index) => (
            <li key={patternRowKey(pattern)}>
              <StudentMistakeRow
                pattern={pattern}
                framing="teacher"
                index={index}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
