/**
 * sessionsKeys — TS-3 query-key factory for the Schedule feature (Story 3.4).
 *
 * `range` is the date-window list (the calendar grid); `byClass` is the
 * class-detail Sessions tab list; `detail` is a single session + series counts.
 * Mutations invalidate `ranges()` / `byClass()` broadly since a scoped edit can
 * touch many rows across the visible window.
 */
export const sessionsKeys = {
  all: ['sessions'] as const,
  ranges: () => [...sessionsKeys.all, 'range'] as const,
  range: (from: string, to: string, classId?: string | null) =>
    [...sessionsKeys.all, 'range', from, to, classId ?? null] as const,
  byClasses: () => [...sessionsKeys.all, 'byClass'] as const,
  byClass: (classId: string, from: string, to: string) =>
    [...sessionsKeys.all, 'byClass', classId, from, to] as const,
  details: () => [...sessionsKeys.all, 'detail'] as const,
  detail: (id: string) => [...sessionsKeys.all, 'detail', id] as const,
  createMutation: () => [...sessionsKeys.all, 'mutation', 'create'] as const,
  updateMutation: (id: string) =>
    [...sessionsKeys.all, 'mutation', 'update', id] as const,
  cancelMutation: (id: string) =>
    [...sessionsKeys.all, 'mutation', 'cancel', id] as const,
  deleteMutation: (id: string) =>
    [...sessionsKeys.all, 'mutation', 'delete', id] as const,
} as const
