/**
 * analyticsKeys — TS-3 query-key factory for the analytics reads (Story 8-2b,
 * Task 2). Two page-level reads: the role-scoped home (`GET /api/analytics`) and
 * one class-performance read (`GET /api/analytics/classes/{id}`). The server
 * self-scopes by `tc.Role`, so no per-role keys — the cache entry is inherently
 * caller-specific (the session cache clears on auth transition).
 *
 * `classPerf` carries a `params` slot (empty by default) so FU-8-2-D (custom
 * date range) grows ADDITIVELY — a future `{ range }` argument keys a distinct
 * cache entry without renaming the factory (Winston, create-story).
 */
export const analyticsKeys = {
  all: ['analytics'] as const,
  home: () => [...analyticsKeys.all, 'home'] as const,
  classPerf: (id: string, params: Readonly<Record<string, unknown>> = {}) =>
    [...analyticsKeys.all, 'classPerf', id, params] as const,
  // Story 8-3b — the per-student teacher detail (GET /api/analytics/students/{id})
  // and the calling student's own view (GET /api/analytics/me).
  student: (id: string) => [...analyticsKeys.all, 'student', id] as const,
  me: () => [...analyticsKeys.all, 'me'] as const,
} as const
