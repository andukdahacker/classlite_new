/**
 * useReleaseAutoGrade — Story 6.4b (AC10/AC11, D2/D4). POSTs the irreversible objective
 * release to `POST /api/submissions/{id}/release` (NO request body) and returns the
 * appended `Grade`. Reuses the 6.1 atomic grade+release path server-side (flips
 * submitted→graded, enqueues the student notification). Distinct from the writing/speaking
 * `POST …/grade` endpoint.
 *
 * D2 invalidation (release, NOT override): a release flips queue membership
 * (submitted→graded) → invalidate `detail` + `all` so both the grading read and the class
 * queue refetch. No optimistic seed — the composite-key remount on the page re-seeds
 * `released:true` from the refetched grading view.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'
import type { Grade } from './useGradeSubmission'

/** Release the objective auto-grade for submission `submissionId` (no body). */
export function useReleaseAutoGrade(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<Grade, ApiError, void>({
    mutationKey: gradingKeys.releaseMutation(submissionId),
    retry: false,
    mutationFn: () =>
      apiFetch<Grade>(`/api/submissions/${encodeURIComponent(submissionId)}/release`, {
        method: 'POST',
      }),
    onSettled: () => {
      // D2: detail + all — a release changes queue membership.
      queryClient.invalidateQueries({ queryKey: gradingKeys.detail(submissionId) })
      queryClient.invalidateQueries({ queryKey: gradingKeys.all })
    },
  })
}
