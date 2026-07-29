/**
 * jobKeys — TS-3 query-key factory for async AI-generation jobs (Story 4.3b).
 *
 * Architecture pins the poll key at `['jobs', jobId]` (architecture.md:452).
 * Jobs are server state, so they live in TanStack Query, never Zustand
 * (TS-3/FW-6). This is the first job-polling consumer; `useGrading` (the
 * sibling the architecture calls out) does not exist yet.
 */
export const jobKeys = {
  all: ['jobs'] as const,
  detail: (jobId: string) => [...jobKeys.all, jobId] as const,
} as const
