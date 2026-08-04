/**
 * assignmentKeys — TS-3 query-key factory for the student assignments list
 * (Story 5.2c). The list is enrollment-scoped SERVER-side (no center/scope
 * discriminator needed — a student only ever sees their own enrolled-class
 * assignments), so the key carries just the page/pageSize params. Each
 * page/pageSize combo occupies its own cache slot.
 */
export interface StudentAssignmentListParams {
  page: number
  pageSize: number
}

export const assignmentKeys = {
  all: ['assignments'] as const,
  lists: () => [...assignmentKeys.all, 'list'] as const,
  list: (params: StudentAssignmentListParams) =>
    [...assignmentKeys.all, 'list', params] as const,
} as const
