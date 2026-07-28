/** Shared props for the five per-type question editors (Story 4.2). */
import type { ExerciseQuestion } from '../../../lib/editorTypes'

export interface QuestionEditorProps {
  question: ExerciseQuestion
  /** Stable dom-id prefix so labels/inputs are unique across many questions. */
  idPrefix: string
  onChange: (next: ExerciseQuestion) => void
}
