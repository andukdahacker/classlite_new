/**
 * useSubmissionReview — Story 5.5a Task 3 (AC2). Reads the caller's OWN pre-grade
 * submission read-back via the additive assignment-keyed `GET /api/assignments/
 * {id}/result`. It uses `apiFetchWithMeta` (not `apiFetch`) so `meta.serverTime`
 * survives the envelope unwrap (TS-4) — the read-only/late derivation anchors on
 * the server clock (never `Date.now()` — TS-6), and the inline `audioUrl` was
 * minted at that server time (the freshness anchor the play-intent refresh reads).
 *
 * NOT `useAttemptBootstrap` (which POSTs `/api/submissions` first and 409s on a
 * terminal submission — AC2). `staleTime: 0` + `retry: false`: a review read is a
 * point-in-time snapshot and its 403/404 outcomes are deterministic, not transient.
 * 401 stays in the fetch layer (TS-5/8).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetchWithMeta, type ApiError } from '@/lib/api-fetch'
import { reviewKeys } from './reviewKeys'

export type StudentSubmissionResult =
  components['schemas']['StudentSubmissionResult']
type ResultMeta = components['schemas']['EnvelopeMeta']

export interface SubmissionReviewData {
  /** The unwrapped review payload (read-back shell / resume CTA). */
  result: StudentSubmissionResult
  /** Server clock from the envelope — the read-only/late reference + audio mint anchor. */
  serverTime: string
}

/**
 * Fetch the caller's own submission review for `assignmentId`.
 * @param assignmentId the assignment whose own submission to review.
 * @returns TanStack Query result whose `data` is `{ result, serverTime }`.
 */
export function useSubmissionReview(assignmentId: string) {
  return useQuery<SubmissionReviewData, ApiError>({
    queryKey: reviewKeys.detail(assignmentId),
    queryFn: async (): Promise<SubmissionReviewData> => {
      const envelope = await apiFetchWithMeta<StudentSubmissionResult, ResultMeta>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/result`,
      )
      return { result: envelope.data, serverTime: envelope.meta.serverTime }
    },
    staleTime: 0,
    retry: false,
  })
}
