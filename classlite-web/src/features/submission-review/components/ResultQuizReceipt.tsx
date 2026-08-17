/**
 * ResultQuizReceipt — Story 5.5a Task 4 (AC9, D11 BLOCKER). The read-only playback
 * of a reading/listening/vocabulary submission, framed as a RECEIPT of the
 * student's OWN answers ("your submitted answers — grading not released"), NOT a
 * de-ticked correctness scorecard: each answer sits beside its question STEM (an
 * answer without its stem is hollow), there are NO your-answer/correct-answer
 * columns and NO checkmark cells. It reuses the shipped, `disabled` attempt leaves
 * (ChoiceOption / GapInput / MatchingBoard) seeded from `content.answers`, and the
 * shared AttemptAudioPlayer for a listening section's SOURCE clip — distinct from a
 * speaking submission's own recording. `correctAnswer`/`acceptedVariants` are
 * structurally absent from the answer-stripped bundle (5.2a), so none can leak.
 */
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { components } from '@/lib/api/client'
import { buildHandle, flattenQuestions } from '@/features/quiz-attempt/lib/attemptContent'
import { AttemptAudioPlayer } from '@/features/quiz-attempt/components/AttemptAudioPlayer'
import { ChoiceOption } from '@/features/quiz-attempt/components/ChoiceOption'
import { GapInput } from '@/features/quiz-attempt/components/GapInput'
import {
  MatchingBoard,
  type MatchingRow,
} from '@/features/quiz-attempt/components/MatchingBoard'
import { readQuizAnswers, readQuizFlagged } from '../lib/submissionContent'

type Submission = components['schemas']['Submission']
type AttemptExercise = components['schemas']['AttemptExercise']

export interface ResultQuizReceiptProps {
  submission: Submission
  exercise: AttemptExercise
}

/** Read-only leaves never mutate — a shared no-op keeps the disabled contract. */
const noop = (): void => {}

export function ResultQuizReceipt({ submission, exercise }: ResultQuizReceiptProps) {
  const { t } = useTranslation()
  const answers = readQuizAnswers(submission)
  const flagged = readQuizFlagged(submission)

  const numberOf = new Map<string, number>()
  flattenQuestions(exercise).forEach((flat, index) => numberOf.set(flat.handle, index + 1))

  return (
    <section
      data-testid="result-quiz-receipt"
      data-mobile-legible="true"
      className="flex flex-col gap-6"
    >
      {/* Receipt framing (D11) — NOT a correctness grid. */}
      <p className="text-sm text-[var(--cl-ink-soft)]">
        {t('submissionReview.answers.label')}
      </p>

      {exercise.sections.map((section, si) => (
        <div key={si} className="flex flex-col gap-4">
          {section.title ? (
            <h2 className="font-[var(--cl-font-display)] text-lg text-[var(--cl-ink)]">
              {section.title}
            </h2>
          ) : null}
          {section.type === 'listening' ? (
            <AttemptAudioPlayer content={section.content} />
          ) : section.content ? (
            <div className="whitespace-pre-wrap text-base text-[var(--cl-ink)]">
              {section.content}
            </div>
          ) : null}

          {section.questionGroups.map((group, gi) => {
            if (group.type === 'matching') {
              const rows: MatchingRow[] = group.questions.map((question, qi) => {
                const handle = buildHandle(si, gi, qi)
                return { handle, questionNumber: numberOf.get(handle) ?? 0, question }
              })
              const values: Record<string, string> = {}
              for (const row of rows) values[row.handle] = answers[row.handle] ?? ''
              return (
                <div key={`${si}:${gi}`} className="flex flex-col gap-2">
                  <MatchingBoard
                    rows={rows}
                    values={values}
                    onChange={noop}
                    disabled
                    currentHandle={null}
                    flagged={flagged}
                    onToggleFlag={noop}
                  />
                </div>
              )
            }
            return group.questions.map((question, qi) => {
              const handle = buildHandle(si, gi, qi)
              const number = numberOf.get(handle) ?? 0
              const value = answers[handle] ?? ''
              const isChoice =
                group.type === 'true_false_not_given' || group.type === 'multiple_choice'
              return (
                <div
                  key={handle}
                  className={cn(
                    'flex flex-col gap-2 rounded-[var(--cl-radius-md)] border border-[var(--cl-line)] p-3',
                  )}
                >
                  {isChoice ? (
                    <ChoiceOption
                      handle={handle}
                      questionNumber={number}
                      question={question}
                      groupType={group.type as 'true_false_not_given' | 'multiple_choice'}
                      value={value}
                      onChange={noop}
                      disabled
                    />
                  ) : (
                    <GapInput
                      handle={handle}
                      questionNumber={number}
                      question={question}
                      value={value}
                      onChange={noop}
                      disabled
                    />
                  )}
                  {/* AC9/D11: surface the questions the student flagged during the
                      attempt (content.flagged) read-only — a marker, not a toggle. */}
                  {flagged.has(handle) ? (
                    <span
                      data-testid={`result-flagged-${handle}`}
                      className="self-start text-xs font-medium text-[var(--cl-muted)]"
                    >
                      {t('submissionReview.answers.flagged')}
                    </span>
                  ) : null}
                </div>
              )
            })
          })}
        </div>
      ))}
    </section>
  )
}
