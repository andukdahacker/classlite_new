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
} as const
