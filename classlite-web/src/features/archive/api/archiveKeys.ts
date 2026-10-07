/**
 * archiveKeys — TS-3 query-key factory for the Archive (Story 10.2).
 *
 * The list key carries a `scope` discriminator (owner/admin `'all'` vs a
 * teacher's own-scoped `'teacher:<userId>'`) because the server role-scopes the
 * same GET /api/archive — a teacher and an owner must NOT share a cache slot
 * (they'd collide on identical query strings with different row sets). The full
 * params object (page + type filter) keys each combo to its own slot.
 */
export type ArchiveScope = 'all' | `teacher:${string}`

/** The archive type filter — '' is the merged union (no filter). */
export type ArchiveTypeFilter = '' | 'class' | 'exercise'

export interface ArchiveListParams {
  page: number
  pageSize: number
  type: ArchiveTypeFilter
}

/** Default page size for the archive list (matches the server default). */
export const ARCHIVE_PAGE_SIZE = 20

export const archiveKeys = {
  all: ['archive'] as const,
  lists: () => [...archiveKeys.all, 'list'] as const,
  list: (centerId: string, scope: ArchiveScope, params: ArchiveListParams) =>
    [...archiveKeys.all, 'list', centerId, scope, params] as const,
  listDisabled: () => [...archiveKeys.all, 'list', '__disabled__'] as const,
} as const
