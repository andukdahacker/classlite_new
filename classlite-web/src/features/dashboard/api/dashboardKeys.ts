/**
 * dashboardKeys — TS-3 query-key factory for the role-scoped dashboard read
 * (Story 8-1b, Task 2). One page-level key: the single GET /api/dashboard the
 * dispatcher's mounted role component makes (AC3). No per-role keys — the server
 * self-scopes by `tc.Role` and returns exactly the caller's block, so the cache
 * entry is inherently caller-specific (the session cache is cleared on auth
 * transition, so a role switch never reads a stale block).
 */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  data: () => [...dashboardKeys.all, 'data'] as const,
} as const
