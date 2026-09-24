/**
 * StudentPatternsList — the softened student `s37` "Focus areas" tab (Story 8-3b,
 * Task 4, AC11-12, §8.4/§6.1, D5/D-SOFTEN). The SAME mistake data rendered as a
 * CALM, coaching view keyed off `framing==='student'`:
 *   - coaching copy namespace (`analytics.myPerformance.patterns.*`) — NEVER the
 *     teacher "mistake"/"error" keys;
 *   - praise rows (`type='praise'`) interleaved in server order;
 *   - the mined `exampleQuote` + teacher tip revealed where present;
 *   - a `worsening` trend NEUTRALIZED to a calm focus-area label — NEVER red, no
 *     ▼ glyph (§6.1:346);
 *   - NO `affectedStudentCount` (suppressed — Winston #7), NO class average, NO
 *     peer value of any kind (FR-50 defence-in-depth — AC19);
 *   - a dashed "only your own data" note (§8.4:499). The "inline practice links"
 *     clause is OUT OF SCOPE (no material-link contract field — Sally #3).
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

export interface StudentPatternsListProps {
  patterns: MistakePattern[]
}

type Filter = SkillSource | 'all'

export function StudentPatternsList({
  patterns,
}: StudentPatternsListProps): ReactElement {
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
    <div className="flex flex-col gap-4" data-testid="student-patterns-list">
      {/* Only-your-own-data coaching note (§8.4:499). */}
      <p
        data-testid="student-patterns-own-data-note"
        className="rounded-lg border border-dashed border-[var(--cl-border)] px-3 py-2 text-xs text-[var(--cl-ink-soft)]"
      >
        {t('analytics.myPerformance.patterns.ownDataNote')}
      </p>

      {presentSkills.length > 1 ? (
        <div
          role="group"
          aria-label={t('analytics.myPerformance.patterns.filterLabel')}
          className="flex flex-wrap gap-2"
        >
          {(['all', ...presentSkills] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              data-testid={`student-patterns-filter-${f}`}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
              className={
                filter === f
                  ? 'rounded-full bg-[var(--cl-ink)] px-3 py-1 text-xs font-medium text-[var(--cl-paper)]'
                  : 'rounded-full border border-[var(--cl-border)] px-3 py-1 text-xs text-[var(--cl-ink-soft)] hover:border-[var(--cl-ink-soft)]'
              }
            >
              {f === 'all'
                ? t('analytics.myPerformance.patterns.filter.all')
                : t(`analytics.skillSource.${f}`)}
            </button>
          ))}
        </div>
      ) : null}

      {visible.length === 0 ? (
        <p
          data-testid="student-patterns-empty"
          className="text-sm text-[var(--cl-ink-soft)]"
        >
          {t('analytics.myPerformance.patterns.empty')}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((pattern, index) => (
            <li key={patternRowKey(pattern)}>
              <StudentMistakeRow
                pattern={pattern}
                framing="student"
                index={index}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
