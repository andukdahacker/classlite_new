/**
 * Questions feature barrel (Story 7.4b). Public surface for cross-feature
 * imports (TS-7 — consumers import from '@/features/questions', never deep
 * paths). The student rail is mounted by the quiz-attempt AttemptPage; the
 * teacher console is lazily routed in routes.tsx.
 */
export { StudentQuestionPanel } from './components/StudentQuestionPanel'
export { QuestionsConsolePage } from './QuestionsConsolePage'
export { questionsKeys, type QuestionListParams } from './api/questionsKeys'
export {
  useQuestions,
  useQuestionThread,
  type Question,
  type QuestionReply,
  type QuestionThread,
  type QuestionAnchor,
  type QuestionStatus,
  type QuestionVisibility,
  type QuestionAnchorType,
} from './api/useQuestions'
export {
  useAskQuestion,
  useReplyToQuestion,
  useResolveQuestion,
  useBatchReply,
} from './api/useQuestionActions'
