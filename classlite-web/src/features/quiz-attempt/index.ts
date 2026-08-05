/**
 * quiz-attempt feature barrel — Story 5.2b (TS-7). The public surface consumed
 * by the route table. The route deep-imports `AttemptPage` for its own Rolldown
 * chunk (students never pay for it elsewhere); this barrel exists for
 * cross-feature type reuse and tests.
 */
export { AttemptPage, default } from './AttemptPage'
export { ExerciseAttemptShell } from './components/ExerciseAttemptShell'
export { SubmissionConfirmation } from './components/SubmissionConfirmation'
export { useAttemptBootstrap } from './api/useAttemptBootstrap'
export { attemptKeys } from './api/attemptKeys'
export type { AttemptContent } from './lib/attemptContent'
