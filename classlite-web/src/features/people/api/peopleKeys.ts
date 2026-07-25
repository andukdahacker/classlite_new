/**
 * peopleKeys — TS-3 query-key factory for the People feature (Story 2.7).
 *
 * Bulk student import is mutation-only (preview + confirm are POSTs with no
 * cached GET), so today this factory holds just the two mutation keys. Story 7.2
 * (the s42 center-wide student list) will extend it with the list/detail query
 * slots; mirror the shipped `settingsKeys.ts` shape so a prefix
 * `invalidateQueries({ queryKey: peopleKeys.all })` cascades.
 */
export const peopleKeys = {
  all: ['people'] as const,
  importPreviewMutation: () =>
    [...peopleKeys.all, 'mutation', 'importPreview'] as const,
  importConfirmMutation: () =>
    [...peopleKeys.all, 'mutation', 'importConfirm'] as const,
} as const
