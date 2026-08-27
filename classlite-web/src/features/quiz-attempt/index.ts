/**
 * quiz-attempt feature barrel — Story 5.2b (TS-7), slimmed in Story 5.2d. The
 * public surface consumed by the route table. The route deep-imports `AttemptPage`
 * for its own Rolldown chunk (students never pay for it elsewhere); this barrel
 * exists for cross-feature type reuse and tests. The shared attempt spine
 * (bootstrap / keys / save-status indicator / confirmation) now lives in
 * `@/features/attempts`; only quiz-shaped surface remains here.
 */
export { AttemptPage, default } from './AttemptPage'
export { ExerciseAttemptShell } from './components/ExerciseAttemptShell'
export type { AttemptContent, FlatQuestion } from './lib/attemptContent'
// Story 6.4b — the teacher objective-grading breakdown reuses the attempt's document-order
// question walk (keyed by the colon handle) to render + order rows (TS-7 barrel reuse).
export { flattenQuestions, parseHandle, buildHandle } from './lib/attemptContent'
