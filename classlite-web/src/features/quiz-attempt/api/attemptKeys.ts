/**
 * attemptKeys — TS-3 query-key factory for the quiz-attempt feature (Story 5.2b).
 *
 * The attempt is submission-keyed (D2): the route is assignment-keyed but every
 * cache slot below hangs off the `submissionId` minted by `POST /submissions`.
 * `draft` is the mutation-managed answer slice (Winston-S1 / D9) — answers +
 * flagged live in the Query cache, not `useState`, so they survive remount /
 * Suspense / error-boundary. `bundle` is the answer-stripped read bundle.
 */
export const attemptKeys = {
  all: ['attempt'] as const,
  /** The answer-stripped read bundle (submission + assignment + exercise). */
  bundle: (submissionId: string) =>
    [...attemptKeys.all, 'bundle', submissionId] as const,
  /** The mutation-managed answer/flag draft slice (D9). */
  draft: (submissionId: string) =>
    [...attemptKeys.all, 'draft', submissionId] as const,
  /** The start/resume POST keyed by the assignment (D2). */
  startMutation: (assignmentId: string) =>
    [...attemptKeys.all, 'mutation', 'start', assignmentId] as const,
  /** The finalize POST keyed by the submission. */
  submitMutation: (submissionId: string) =>
    [...attemptKeys.all, 'mutation', 'submit', submissionId] as const,
} as const
