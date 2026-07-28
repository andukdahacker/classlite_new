/**
 * questionTypes — Story 4.2. The five question-group types, their i18n label
 * keys, empty-question / empty-group factories, and the Matching heading-bank
 * helpers (the bank is replicated into every item's `options` in v1, per the
 * Dev Notes per-type contract).
 */
import type {
  ExerciseQuestion,
  QuestionGroup,
  QuestionGroupType,
} from './editorTypes'

/** The five question types offered when adding a group (AC3). */
export const QUESTION_GROUP_TYPES: QuestionGroupType[] = [
  'true_false_not_given',
  'multiple_choice',
  'matching',
  'fill_in_blank',
  'short_answer',
]

/** The fixed True / Not Given / False triad (AC3). */
export const TFNG_ANSWERS = ['true', 'notGiven', 'false'] as const

const MCQ_DEFAULT_OPTION_COUNT = 2

export function questionTypeLabelKey(type: QuestionGroupType): string {
  return `exercises.editor.questionType.${type}`
}

/** Empty-question factory per type. MCQ seeds two blank options (the minimum
 * valid count) so the editor opens on a well-formed shape. */
export function newQuestion(type: QuestionGroupType): ExerciseQuestion {
  const base: ExerciseQuestion = {
    text: '',
    type,
    options: [],
    correctAnswer: '',
    acceptedVariants: [],
  }
  switch (type) {
    case 'true_false_not_given':
      return { ...base, correctAnswer: 'true' }
    case 'multiple_choice':
      return { ...base, options: Array<string>(MCQ_DEFAULT_OPTION_COUNT).fill('') }
    default:
      return base
  }
}

/** Empty-group factory — one blank question so the group is never empty
 * (≥1-question invariant is enforced in the UI + server). */
export function newQuestionGroup(type: QuestionGroupType): QuestionGroup {
  return { type, instructions: '', questions: [newQuestion(type)] }
}

// --- Matching heading-bank helpers (shared bank ↔ per-item select) ----------

/** The group's shared heading bank — the options replicated across every item.
 * Reads the first item's options (all items carry the same bank in v1). */
export function matchingBank(group: QuestionGroup): string[] {
  return group.questions[0]?.options ?? []
}

/** Rewrites the shared bank into EVERY item's `options`, dropping any item's
 * `correctAnswer` that is no longer in the bank (a removed heading can't stay
 * selected). Use this for add / remove / reorder — NOT rename (see
 * `renameMatchingHeading`, which preserves the pointer across a text edit). */
export function withMatchingBank(group: QuestionGroup, bank: string[]): QuestionGroup {
  return {
    ...group,
    questions: group.questions.map((q) => ({
      ...q,
      options: bank,
      correctAnswer: bank.includes(q.correctAnswer) ? q.correctAnswer : '',
    })),
  }
}

/** Renames the heading at `index`, carrying any item whose selected answer
 * pointed at the OLD heading text over to the new text. Mirrors
 * `McqQuestionEditor.setOptionText`: a rename must NOT silently drop the answer
 * key. (Going through `withMatchingBank` on a rename would reset every pointer
 * to the renamed heading on the first keystroke — the data-loss bug this fixes.) */
export function renameMatchingHeading(
  group: QuestionGroup,
  index: number,
  nextText: string,
): QuestionGroup {
  const oldText = matchingBank(group)[index]
  const nextBank = matchingBank(group).map((h, i) => (i === index ? nextText : h))
  return {
    ...group,
    questions: group.questions.map((q) => ({
      ...q,
      options: nextBank,
      correctAnswer: q.correctAnswer === oldText ? nextText : q.correctAnswer,
    })),
  }
}
