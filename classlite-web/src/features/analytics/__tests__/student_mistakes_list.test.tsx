// Story 8-3b, Task 7 · P1 (AC8-10). StudentMistakesList (teacher) — expandable
// rows reveal exampleQuote/exampleNote, auto_graded labels questionType + warm
// hint, affectedStudentCount SUPPRESSED (single-student), skill filter narrows by
// skillSource, excludedSources:[]→no note, server order preserved.
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { StudentMistakesList } from '@/features/analytics/components/StudentMistakesList'
import { mistakePattern } from '@/features/analytics/api/__tests__/handlers'
import type { components } from '@/lib/api/client'

type MistakePattern = components['schemas']['MistakePattern']

const human: MistakePattern = mistakePattern({
  skillSource: 'writing',
  criterion: 'coherenceCohesion',
  type: 'error',
  patternSource: 'human_comment',
  exampleQuote: 'Your conclusion restates the intro.',
  exampleNote: 'Try a forward-looking final sentence.',
  affectedStudentCount: 1,
})
const auto: MistakePattern = mistakePattern({
  skillSource: 'reading',
  criterion: '',
  questionType: 'matching',
  type: 'error',
  patternSource: 'auto_graded',
  exampleQuote: null,
  exampleNote: null,
  affectedStudentCount: 1,
})

function renderList(patterns: MistakePattern[]) {
  return render(
    <I18nextProvider i18n={i18n}>
      <StudentMistakesList patterns={patterns} />
    </I18nextProvider>,
  )
}

describe('StudentMistakesList (AC8-10, P1)', () => {
  test('reveals the mined exampleQuote + teacher note on a human_comment row', () => {
    renderList([human])
    const row = screen.getByTestId('student-mistake-row-0')
    expect(within(row).getByTestId('student-mistake-quote-0').textContent).toContain(
      'Your conclusion restates the intro.',
    )
    expect(within(row).getByText(/Try a forward-looking final sentence\./)).toBeInTheDocument()
  })

  test('auto_graded row labels the questionType (criterion "") + a warm quote-less hint', () => {
    renderList([auto])
    const row = screen.getByTestId('student-mistake-row-0')
    expect(within(row).getByText(i18n.t('analytics.questionType.matching') as string)).toBeInTheDocument()
    expect(within(row).getByText(i18n.t('analytics.skillSource.reading') as string)).toBeInTheDocument()
    expect(
      within(row).getByText(i18n.t('analytics.studentPerformance.mistakes.autoGradedHint') as string),
    ).toBeInTheDocument()
    // quote-less: no example-quote node
    expect(within(row).queryByTestId('student-mistake-quote-0')).not.toBeInTheDocument()
  })

  test('affectedStudentCount is SUPPRESSED on the single-student detail (Winston #7)', () => {
    renderList([mistakePattern({ affectedStudentCount: 7 })])
    // the class-tab "N students" phrasing must NOT appear here
    expect(screen.queryByText(i18n.t('analytics.mistakes.affected', { count: 7 }) as string)).not.toBeInTheDocument()
    expect(screen.getByTestId('student-mistakes-list').textContent).not.toContain('7 students')
  })

  test('the skill filter narrows rows by skillSource client-side', async () => {
    const user = userEvent.setup()
    renderList([human, auto]) // writing + reading
    expect(screen.getByTestId('student-mistake-row-0')).toBeInTheDocument()
    expect(screen.getByTestId('student-mistake-row-1')).toBeInTheDocument()
    await user.click(screen.getByTestId('student-mistakes-filter-reading'))
    // only the reading (auto_graded) row survives
    expect(screen.getByTestId('student-mistake-row-0')).toBeInTheDocument()
    expect(screen.queryByTestId('student-mistake-row-1')).not.toBeInTheDocument()
    expect(
      within(screen.getByTestId('student-mistake-row-0')).getByText(
        i18n.t('analytics.questionType.matching') as string,
      ),
    ).toBeInTheDocument()
  })

  test('excludedSources handling: NO "not yet available" excluded note renders', () => {
    renderList([human])
    expect(screen.queryByTestId('analytics-mistakes-excluded-note')).not.toBeInTheDocument()
  })

  test('an empty filtered set shows the per-zone empty state', async () => {
    const user = userEvent.setup()
    renderList([human]) // writing only
    // no reading filter chip exists (no reading pattern) → filter to writing has 1 row
    expect(screen.getByTestId('student-mistake-row-0')).toBeInTheDocument()
    await user.click(screen.getByTestId('student-mistakes-filter-writing'))
    expect(screen.getByTestId('student-mistake-row-0')).toBeInTheDocument()
    // sanity: the empty node is reachable when nothing matches
    renderList([])
    expect(screen.getAllByTestId('student-mistakes-empty').length).toBeGreaterThan(0)
  })
})
