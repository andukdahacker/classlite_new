/**
 * peopleKeys — TS-3 query-key factory for the People feature (Story 2.7 + 7.1b).
 *
 * Bulk student import is mutation-only (preview + confirm are POSTs with no
 * cached GET). Story 7.1b adds the staff roster (`staffList`) + member detail
 * (`staffDetail`) query slots and the five Owner-action mutation slots. All keys
 * hang off `all: ['people']` so a prefix
 * `invalidateQueries({ queryKey: peopleKeys.all })` cascades every slot.
 */
export const peopleKeys = {
  all: ['people'] as const,
  importPreviewMutation: () =>
    [...peopleKeys.all, 'mutation', 'importPreview'] as const,
  importConfirmMutation: () =>
    [...peopleKeys.all, 'mutation', 'importConfirm'] as const,
  // Story 7.1b — staff roster + detail reads.
  staffList: () => [...peopleKeys.all, 'staff', 'list'] as const,
  staffDetail: (userId: string) =>
    [...peopleKeys.all, 'staff', 'detail', userId] as const,
  // Story 7.1b — Owner-action + invite mutation slots.
  inviteMutation: () => [...peopleKeys.all, 'mutation', 'invite'] as const,
  assignClassMutation: () =>
    [...peopleKeys.all, 'mutation', 'assignClass'] as const,
  archiveMutation: () => [...peopleKeys.all, 'mutation', 'archive'] as const,
  resetPasswordMutation: () =>
    [...peopleKeys.all, 'mutation', 'resetPassword'] as const,
  forceLogoutMutation: () =>
    [...peopleKeys.all, 'mutation', 'forceLogout'] as const,
  // Story 7.2b — student roster (paginated) + whole-student detail + notes reads.
  // `params` is the server-side query slice (page/class_id/teacher_id) so a
  // filter-chip change is a distinct cache entry (TS-3 partial-match still
  // cascades from `studentList` because the params object is the last segment).
  studentList: (params: StudentListParams) =>
    [...peopleKeys.all, 'student', 'list', params] as const,
  studentDetail: (studentId: string) =>
    [...peopleKeys.all, 'student', 'detail', studentId] as const,
  studentNotes: (studentId: string) =>
    [...peopleKeys.all, 'student', 'notes', studentId] as const,
  // Story 7.2b — teacher-note mutation slots.
  createNoteMutation: () =>
    [...peopleKeys.all, 'mutation', 'createNote'] as const,
  flagNoteMutation: () => [...peopleKeys.all, 'mutation', 'flagNote'] as const,
  deleteNoteMutation: () =>
    [...peopleKeys.all, 'mutation', 'deleteNote'] as const,
} as const

/**
 * StudentListParams — the server-side query slice for the roster read. `page`
 * is the pager offset (D6); `classId` / `teacherId` are the server-side filter
 * chips (never client-only, else the client-tab counts drift — AC10). Undefined
 * fields are omitted from the querystring by the hook.
 */
export interface StudentListParams {
  page: number
  classId?: string
  teacherId?: string
}
