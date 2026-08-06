/**
 * useAttemptBootstrap — Story 5.2b (AC1, D2). The two-call start/resume bootstrap
 * as ONE query (so there is no fetch-in-`useEffect`, FW-1/FW-4):
 *   1. `POST /api/submissions { assignmentId }` — idempotent start/resume.
 *   2. `GET /api/submissions/{id}/attempt` — the answer-stripped bundle +
 *      `meta.serverTime` (the timer anchor), read via `apiFetchWithMeta`.
 * The POST is idempotent (`started_at` set once), so running it inside a query
 * is safe. A terminal/locked start surfaces its typed `ApiError` (the page maps
 * `SUBMISSION_EXISTS` → the confirmation end-state, `SUBMISSION_LOCKED` →
 * read-only). `retry: false` so a 409/403/404 is not retried.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, apiFetchWithMeta } from '@/lib/api-fetch'
import { attemptKeys } from './attemptKeys'

type Submission = components['schemas']['Submission']
type CreateSubmissionRequest = components['schemas']['CreateSubmissionRequest']
type AttemptBundle = components['schemas']['AttemptBundle']
type EnvelopeMeta = components['schemas']['EnvelopeMeta']

export interface AttemptBootstrapResult {
  submissionId: string
  bundle: AttemptBundle
  serverTime: string
  perfAtLoad: number
}

export function useAttemptBootstrap(
  assignmentId: string,
  perfNow: () => number = () => performance.now(),
) {
  return useQuery({
    queryKey: [...attemptKeys.all, 'bootstrap', assignmentId] as const,
    staleTime: 0,
    retry: false,
    queryFn: async (): Promise<AttemptBootstrapResult> => {
      const body: CreateSubmissionRequest = { assignmentId }
      const submission = await apiFetch<Submission>('/api/submissions', {
        method: 'POST',
        body: JSON.stringify(body),
      })
      const envelope = await apiFetchWithMeta<AttemptBundle, EnvelopeMeta>(
        `/api/submissions/${submission.id}/attempt`,
      )
      return {
        submissionId: submission.id,
        bundle: envelope.data,
        serverTime: envelope.meta.serverTime,
        perfAtLoad: perfNow(),
      }
    },
  })
}
