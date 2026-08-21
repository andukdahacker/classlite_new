// Story 6.2b AC8 (negative) — the STUDENT graded path must render NO AI chrome. A
// comment the teacher accepted from an AI suggestion reaches the student as the
// teacher's OWN plain comment: the wire `StudentGradeView.comments` (AnchoredComment)
// carries no confidence/rationale, and GradedEssay renders no AI avatar/badge/panel.
// This pins that confidence/rationale (UX-DR22) can never surface to a student.
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
import { GradedEssay } from '../components/GradedEssay'

type StudentGradeView = components['schemas']['StudentGradeView']
type Submission = components['schemas']['Submission']

const submission: Submission = {
  id: 'sub-5',
  centerId: 'c-1',
  assignmentId: 'a-1',
  studentId: 'stu-1',
  status: 'graded',
  isLate: false,
  appliedPenalty: 0,
  startedAt: '2026-08-13T00:00:00Z',
  submittedAt: '2026-08-13T12:00:00Z',
  timeBudgetSeconds: null,
  schemaVersion: 1,
  content: { schemaVersion: 1, text: 'The quick brown fox.' },
  createdAt: '2026-08-13T00:00:00Z',
  updatedAt: '2026-08-13T12:00:00Z',
}

const grade: StudentGradeView = {
  overallBand: 6.5,
  criterionScores: { taskResponse: 6.5, coherenceCohesion: 6, lexicalResource: 7, grammaticalRange: 6.5 },
  // Anchor 4–9 = "quick". This is the SAME comment a teacher accepted from AI.
  comments: [{ type: 'error', criterion: 'taskResponse', anchorStart: 4, anchorEnd: 9, text: 'Tighten this.' }],
  feedback: null,
  gradedAt: '2026-08-19T00:00:00Z',
}

describe('GradedEssay (student) — no AI chrome leaks (AC8)', () => {
  test('an accepted AI comment reads as the teacher\'s own — no avatar / confidence / rationale / panel', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <GradedEssay grade={grade} submission={submission} />
      </I18nextProvider>,
    )
    // The comment renders (as the teacher's own).
    expect(screen.getByText('Tighten this.')).toBeInTheDocument()
    // …but NONE of the teacher-only AI affordances are present in the student DOM.
    expect(screen.queryByTestId('ai-avatar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-confidence')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-grade-suggestion')).not.toBeInTheDocument()
    expect(screen.queryByTestId('ai-grade-panel')).not.toBeInTheDocument()
    // No rationale text leaks either (rationale would read like "why 6.5").
    expect(screen.queryByText(/why \d/i)).not.toBeInTheDocument()
    expect(screen.queryByText(i18n.t('grading.ai.confidence.high'))).not.toBeInTheDocument()
  })
})
