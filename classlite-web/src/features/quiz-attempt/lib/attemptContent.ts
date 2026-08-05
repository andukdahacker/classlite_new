/**
 * attemptContent — Story 5.2b Task 1 (AC10). This story OWNS the quiz-attempt
 * `submission.content` JSONB shape (opaque to the backend, ≤256 KiB):
 *
 *   { schemaVersion: 1, answers: Record<Handle, string>, flagged: Handle[] }
 *   Handle = `${sectionIndex}:${groupIndex}:${questionIndex}`
 *
 * Handles are index-addressed (questions carry no id — 5.2a) and STABLE for the
 * lifetime of the attempt because the exercise is `EXERCISE_LOCKED` once any
 * submission exists (5.1 AC15/D5, `exercise_service.go:670`). Every answer is a
 * string: TFNG ∈ {true,false,notGiven}; MCQ/matching = chosen option/heading
 * string; gap-fill/short-answer = free text. Each save is a FULL replace of
 * `content`.
 *
 * All exports are pure so they unit-test directly and back the Query-cache draft
 * slice (Task 3) + the localStorage mirror (Task 4) without a React harness.
 */
import type { components } from '@/lib/api/client'

type AttemptExercise = components['schemas']['AttemptExercise']
type AttemptSection = components['schemas']['AttemptSection']
type AttemptQuestionGroup = components['schemas']['AttemptQuestionGroup']
type AttemptQuestion = components['schemas']['AttemptQuestion']

/** The only content schema version this story emits (D1). */
export const ATTEMPT_CONTENT_SCHEMA_VERSION = 1 as const

/**
 * The quiz-attempt shape of `submission.content`. The generated
 * `SubmissionContent` is an open `{ [k]: unknown }` bag — this is the concrete
 * shape this feature reads and writes into it.
 */
export interface AttemptContent {
  schemaVersion: typeof ATTEMPT_CONTENT_SCHEMA_VERSION
  answers: Record<string, string>
  flagged: string[]
}

/** A single question lifted out of the nested exercise, with its stable handle. */
export interface FlatQuestion {
  handle: string
  sectionIndex: number
  groupIndex: number
  questionIndex: number
  section: AttemptSection
  group: AttemptQuestionGroup
  question: AttemptQuestion
}

/** Build the stable index-addressed handle for a question. */
export function buildHandle(
  sectionIndex: number,
  groupIndex: number,
  questionIndex: number,
): string {
  return `${sectionIndex}:${groupIndex}:${questionIndex}`
}

/** Parse a handle back into its three indices, or null if malformed. */
export function parseHandle(
  handle: string,
): { sectionIndex: number; groupIndex: number; questionIndex: number } | null {
  const parts = handle.split(':')
  if (parts.length !== 3) return null
  const [si, gi, qi] = parts
  // Non-negative integers only — reject '-1', 'x', '' etc.
  if (!/^\d+$/.test(si) || !/^\d+$/.test(gi) || !/^\d+$/.test(qi)) return null
  return {
    sectionIndex: Number(si),
    groupIndex: Number(gi),
    questionIndex: Number(qi),
  }
}

/**
 * The answered predicate (Murat-e oracle): a value counts as answered iff it is
 * present with a non-empty, non-whitespace string. Absent / empty / whitespace
 * do NOT count. Counting is per-question, never per-group.
 */
export function isAnswered(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0
}

/** The versioned empty content — a fresh, unanswered draft. */
export function emptyAttemptContent(): AttemptContent {
  return { schemaVersion: ATTEMPT_CONTENT_SCHEMA_VERSION, answers: {}, flagged: [] }
}

/** Flatten every question across sections/groups, in document order. */
export function flattenQuestions(exercise: AttemptExercise): FlatQuestion[] {
  const out: FlatQuestion[] = []
  exercise.sections.forEach((section, sectionIndex) => {
    section.questionGroups.forEach((group, groupIndex) => {
      group.questions.forEach((question, questionIndex) => {
        out.push({
          handle: buildHandle(sectionIndex, groupIndex, questionIndex),
          sectionIndex,
          groupIndex,
          questionIndex,
          section,
          group,
          question,
        })
      })
    })
  })
  return out
}

/** Count questions with an answered value. Counts over REAL questions only. */
export function answeredCount(
  content: AttemptContent,
  exercise: AttemptExercise,
): number {
  return flattenQuestions(exercise).reduce(
    (n, f) => (isAnswered(content.answers[f.handle]) ? n + 1 : n),
    0,
  )
}

/** Count real questions with no answered value. */
export function unansweredCount(
  content: AttemptContent,
  exercise: AttemptExercise,
): number {
  return flattenQuestions(exercise).length - answeredCount(content, exercise)
}

/** Count flagged questions. A flag on a non-existent handle is ignored. */
export function flaggedCount(
  content: AttemptContent,
  exercise: AttemptExercise,
): number {
  const flaggedSet = new Set(content.flagged)
  return flattenQuestions(exercise).reduce(
    (n, f) => (flaggedSet.has(f.handle) ? n + 1 : n),
    0,
  )
}

/** True when the handle is flagged for review. */
export function isFlagged(content: AttemptContent, handle: string): boolean {
  return content.flagged.includes(handle)
}

/** Immutably set (full-replace) one handle's answer. */
export function withAnswer(
  content: AttemptContent,
  handle: string,
  value: string,
): AttemptContent {
  return { ...content, answers: { ...content.answers, [handle]: value } }
}

/** Immutably toggle a handle's flag. */
export function withFlagToggled(
  content: AttemptContent,
  handle: string,
): AttemptContent {
  const flagged = content.flagged.includes(handle)
    ? content.flagged.filter((h) => h !== handle)
    : [...content.flagged, handle]
  return { ...content, flagged }
}

/**
 * Coerce an untrusted `content` bag (server response or localStorage) into the
 * concrete `AttemptContent` shape. Non-string answer values and non-string
 * flags are dropped; a missing/mis-typed container degrades to empty content.
 * The `schemaVersion` is always re-stamped to the version this story emits.
 */
export function normalizeAttemptContent(raw: unknown): AttemptContent {
  if (raw === null || typeof raw !== 'object') return emptyAttemptContent()
  const bag = raw as Record<string, unknown>

  const answers: Record<string, string> = {}
  if (bag.answers !== null && typeof bag.answers === 'object' && !Array.isArray(bag.answers)) {
    for (const [handle, value] of Object.entries(bag.answers as Record<string, unknown>)) {
      if (typeof value === 'string') answers[handle] = value
    }
  }

  const flagged: string[] = []
  if (Array.isArray(bag.flagged)) {
    for (const handle of bag.flagged) {
      if (typeof handle === 'string') flagged.push(handle)
    }
  }

  return { schemaVersion: ATTEMPT_CONTENT_SCHEMA_VERSION, answers, flagged }
}
