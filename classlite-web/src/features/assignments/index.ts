/**
 * Assignments feature barrel (Story 5.2c). Public surface for cross-feature
 * imports (TS-7 — consumers import from '@/features/assignments', never deep
 * paths). This is the STUDENT assignments list feature (the entry point into
 * the attempt UIs); the quiz attempt screen lives in its own `quiz-attempt`
 * feature (5.2b), reached by route path, not import (D4).
 */
export { AssignmentsListPage } from './AssignmentsListPage'
export { AssignmentRow } from './AssignmentRow'
export {
  useStudentAssignments,
  type StudentAssignmentListItem,
  type StudentAssignmentListResult,
  type PaginationMeta,
} from './api/useStudentAssignments'
export {
  assignmentKeys,
  type StudentAssignmentListParams,
} from './api/assignmentKeys'
export {
  attemptRouteForSkill,
  isOverdue,
  rowStatus,
  type RowCta,
  type RowStatus,
} from './lib/assignmentRow'
export { formatAssignmentDate } from './lib/formatAssignmentDate'
