// Story 5.5a Task 4 (WF-8, risk 6) — read-back components, MSW-free pure render.
// Covers AC8 (writing pre-wrap read-only) + AC9 (the D11 quiz RECEIPT BLOCKER:
// stem beside each answer, receipt framing, NOT a de-ticked correctness grid,
// correctAnswer/acceptedVariants structurally absent, listening SOURCE audio
// distinct from the student's own recording). axe on each read-back.
//
// RED-PHASE (Story 5.5a, WF-8 risk-6). Excluded from `vitest run` (filename lacks
// `.test`/`.spec`). Dev renames `.red.tsx`→`.test.tsx` per file as each contract
// lands. `tsc --noEmit` red until the feature module + codegen exist (missing
// `@/features/submission-review/*` + `components['schemas']['StudentSubmissionResult']`).
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'
import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
// RED: these read-back components do not exist yet (Task 4).
import {
  ResultWritingReadback,
  ResultQuizReceipt,
} from '@/features/submission-review'

type Submission = components['schemas']['Submission']
type AttemptExercise = components['schemas']['AttemptExercise']
type ExerciseSkill = components['schemas']['ExerciseSkill']

// A sentinel that would ONLY be present if the server leaked a correct answer.
// The answer-stripped bundle omits correctAnswer/acceptedVariants entirely, so
// this string must NEVER reach the DOM (5.2a strip guarantee).
const LEAKED_CORRECT = 'PARIS_IS_CORRECT'

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-5',
    centerId: 'c-1',
    assignmentId: 'a-1',
    studentId: 'user-student',
    status: 'submitted',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z',
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: {},
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
    ...overrides,
  }
}

function quizExercise(skill: ExerciseSkill = 'reading', withAudio = false): AttemptExercise {
  return {
    id: 'ex-1',
    title: 'Quiz',
    skill,
    settings: { timeLimitEnabled: false, timeLimitMinutes: 0, caseSensitive: false },
    sections: [
      {
        type: skill === 'listening' ? 'listening' : 'reading',
        title: 'Section 1',
        // Listening SOURCE audio rides on the section content (AttemptAudioPlayer).
        content: withAudio ? 'https://r2/source-clip.mp3' : 'Read the passage.',
        questionGroups: [
          {
            type: 'multiple_choice',
            instructions: 'Choose the best answer.',
            questions: [
              { text: 'The capital of France is ___.', type: 'multiple_choice', options: ['London', 'Paris', 'Rome'] },
              { text: 'Water boils at ___ °C.', type: 'multiple_choice', options: ['50', '100', '200'] },
            ],
          },
        ],
      },
    ],
  }
}

function renderReadback(node: React.ReactElement) {
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>{node}</MemoryRouter>
    </I18nextProvider>,
  )
}

afterEach(async () => {
  if (i18n.language !== 'en') await i18n.changeLanguage('en')
})

describe('ResultWritingReadback — pre-wrap read-only (AC8/P2-5)', () => {
  const sub = submission({
    content: { schemaVersion: 1, text: 'First line.\n\n  Indented second line.' },
  })

  test('renders content.text read-only with white-space: pre-wrap, no editing', () => {
    renderReadback(<ResultWritingReadback submission={sub} />)
    const block = screen.getByTestId('result-writing-readback')
    expect(block).toHaveTextContent('Indented second line.')
    // Pinned marker: dev applies an inline `white-space: pre-wrap` (preserves the essay layout).
    expect(block).toHaveStyle({ whiteSpace: 'pre-wrap' })
    // Not editable: no editable textbox that accepts input.
    const textbox = screen.queryByRole('textbox')
    if (textbox) expect(textbox).toBeDisabled()
  })

  test('no toolbar and no word-count on the read-back', () => {
    renderReadback(<ResultWritingReadback submission={sub} />)
    expect(screen.queryByTestId('writing-toolbar')).not.toBeInTheDocument()
    expect(screen.queryByTestId('writing-word-count')).not.toBeInTheDocument()
  })

  test('axe clean', async () => {
    const { container } = renderReadback(<ResultWritingReadback submission={sub} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})

describe('ResultQuizReceipt — a receipt, not a scorecard (AC9/P2-6, D11 BLOCKER)', () => {
  const readingSub = submission({
    content: { schemaVersion: 1, answers: { '0:0:0': 'Paris', '0:0:1': '100' }, flagged: ['0:0:1'] },
  })

  test('renders each submitted answer beside its question STEM', () => {
    renderReadback(<ResultQuizReceipt submission={readingSub} exercise={quizExercise('reading')} />)
    const receipt = screen.getByTestId('result-quiz-receipt')
    // Stems are present (an answer without its stem is hollow — "B _of what?_").
    expect(within(receipt).getByText(/The capital of France is/)).toBeInTheDocument()
    expect(within(receipt).getByText(/Water boils at/)).toBeInTheDocument()
    // The student's own submitted answers render.
    expect(within(receipt).getByText('Paris')).toBeInTheDocument()
  })

  test('framed as "your submitted answers — grading not released", NOT a correctness grid', () => {
    renderReadback(<ResultQuizReceipt submission={readingSub} exercise={quizExercise('reading')} />)
    expect(screen.getByTestId('result-quiz-receipt')).toHaveTextContent(
      i18n.t('submissionReview.answers.label'),
    )
    expect(i18n.exists('submissionReview.answers.label', { lng: 'en' })).toBe(true)
    expect(i18n.exists('submissionReview.answers.label', { lng: 'vi' })).toBe(true)
    // NOT a de-ticked scorecard: no "your answer / correct answer" columns, no checkmark cells.
    expect(screen.queryByTestId('result-quiz-correct-column')).not.toBeInTheDocument()
    expect(screen.queryByTestId('correctness-grid')).not.toBeInTheDocument()
    expect(screen.queryByTestId('answer-correctness')).not.toBeInTheDocument()
  })

  test('NEGATIVE: correctAnswer / acceptedVariants values never appear (structurally stripped)', () => {
    renderReadback(<ResultQuizReceipt submission={readingSub} exercise={quizExercise('reading')} />)
    expect(screen.queryByText(LEAKED_CORRECT)).not.toBeInTheDocument()
    // No score attribute leaks into the receipt.
    const receipt = screen.getByTestId('result-quiz-receipt')
    expect(receipt.querySelector('[data-score]')).toBeNull()
  })

  test.each<ExerciseSkill>(['reading', 'vocabulary'])(
    'reuses the disabled answer inputs for the %s shape',
    (skill) => {
      renderReadback(<ResultQuizReceipt submission={readingSub} exercise={quizExercise(skill)} />)
      expect(screen.getByTestId('result-quiz-receipt')).toBeInTheDocument()
    },
  )

  test('listening: SOURCE audio (AttemptAudioPlayer) is DISTINCT from the student recording', () => {
    renderReadback(
      <ResultQuizReceipt submission={readingSub} exercise={quizExercise('listening', true)} />,
    )
    // The section source clip plays via the existing quiz-attempt audio player.
    expect(screen.getByTestId('attempt-audio')).toBeInTheDocument()
    // ...and it is NOT conflated with the student's own recording control (a quiz
    // submission has no speaking playback).
    expect(screen.queryByTestId('result-speaking-audio')).not.toBeInTheDocument()
  })

  test('axe clean', async () => {
    const { container } = renderReadback(
      <ResultQuizReceipt submission={readingSub} exercise={quizExercise('reading')} />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
