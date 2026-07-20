/**
 * classesKeys — TS-3 query-key factory for the Classes feature (Story 3.1).
 *
 * The list key includes a `scope` discriminator: owner/admin lists (`'all'`)
 * and a teacher's own-scoped list (`'teacher:<userId>'`) are DIFFERENT cache
 * entries — the same GET /api/classes returns role-scoped data server-side, so
 * the client must not share one cache slot across audiences. Optimistic
 * patches update every cached `list(...)` scope a class appears in.
 */
export type ClassListScope = 'all' | `teacher:${string}`

export const classesKeys = {
  all: ['classes'] as const,
  lists: () => [...classesKeys.all, 'list'] as const,
  list: (centerId: string, scope: ClassListScope) =>
    [...classesKeys.all, 'list', centerId, scope] as const,
  listDisabled: () => [...classesKeys.all, 'list', '__disabled__'] as const,
  detail: (id: string) => [...classesKeys.all, 'detail', id] as const,
  createMutation: (centerId: string) =>
    [...classesKeys.all, 'mutation', 'create', centerId] as const,
  updateMutation: (id: string) =>
    [...classesKeys.all, 'mutation', 'update', id] as const,
  transitionMutation: (id: string) =>
    [...classesKeys.all, 'mutation', 'transition', id] as const,
} as const
