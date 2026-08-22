/**
 * Public API for the teacher Writing grading feature (Story 6.1). Cross-feature
 * imports go through this barrel (TS-7). The route lazy-imports WritingGradingPage
 * via a deep named import for its own chunk.
 */
export { WritingGradingPage } from './WritingGradingPage'
// Story 6.3a — the skill dispatcher + the Speaking grading surface (s24).
export { GradingRoute } from './GradingRoute'
export { SpeakingGradingPage } from './SpeakingGradingPage'
export { gradingKeys } from './api/gradingKeys'
export { useGradingSubmission, type TeacherGradingView } from './api/useGradingSubmission'
export { useGradingQueue, type GradingQueueRow } from './api/useGradingQueue'
export { useGradeSubmission, type GradeInput, type Grade } from './api/useGradeSubmission'
export { useReviseGrade, type ReviseGradeInput } from './api/useReviseGrade'
export { useGradeSpeaking, type SpeakingGradeInput } from './api/useGradeSpeaking'
export { useReviseSpeakingGrade, type ReviseSpeakingGradeInput } from './api/useReviseSpeakingGrade'
export { useTeacherSubmissionAudioUrl } from './api/useTeacherSubmissionAudioUrl'
export {
  SPEAKING_CRITERION_KEYS,
  computeSpeakingOverallBand,
  speakingOverallBandMath,
  type SpeakingCriterionScores,
  type SpeakingCriterionKey,
} from './lib/speakingOverallBand'
export {
  computeOverallBand,
  overallBandMath,
  isValidBand,
  CRITERION_KEYS,
  type CriterionScores,
} from './lib/computeOverallBand'
