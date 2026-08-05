/**
 * questionField — shared prop contract for the student answer inputs (Task 6).
 * Every input reduces its answer to a single string keyed by the question's
 * stable handle (D1).
 */
import type { components } from '@/lib/api/client'

type AttemptQuestion = components['schemas']['AttemptQuestion']

export interface QuestionFieldProps {
  /** Stable index-addressed handle `${si}:${gi}:${qi}` (D1). */
  handle: string
  /** 1-based global question number for the label. */
  questionNumber: number
  question: AttemptQuestion
  /** Current answer ('' when unanswered). */
  value: string
  /** Full-replace this question's answer. */
  onChange: (value: string) => void
  disabled?: boolean
}
