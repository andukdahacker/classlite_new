/**
 * exercisesKeys — TS-3 query-key factory for the Exercise Library (Story 4.1).
 *
 * The list key includes a `scope` discriminator (owner/admin `'all'` vs a
 * teacher's own-scoped `'teacher:<userId>'` — the server role-scopes the same
 * GET /api/exercises, so audiences must not share a cache slot) AND the full
 * filter+page params object, so each filter/page combo occupies its own slot.
 */
export type ExerciseListScope = 'all' | `teacher:${string}`

export interface ExerciseListParams {
  page: number
  pageSize: number
  skill: string | null
  tag: string | null
  band: number | null
}

export const exerciseKeys = {
  all: ['exercises'] as const,
  lists: () => [...exerciseKeys.all, 'list'] as const,
  list: (centerId: string, scope: ExerciseListScope, params: ExerciseListParams) =>
    [...exerciseKeys.all, 'list', centerId, scope, params] as const,
  listDisabled: () => [...exerciseKeys.all, 'list', '__disabled__'] as const,
  detail: (id: string) => [...exerciseKeys.all, 'detail', id] as const,
  createMutation: (centerId: string) =>
    [...exerciseKeys.all, 'mutation', 'create', centerId] as const,
  updateMutation: (id: string) =>
    [...exerciseKeys.all, 'mutation', 'update', id] as const,
  deleteMutation: (id: string) =>
    [...exerciseKeys.all, 'mutation', 'delete', id] as const,
  duplicateMutation: (id: string) =>
    [...exerciseKeys.all, 'mutation', 'duplicate', id] as const,
} as const
