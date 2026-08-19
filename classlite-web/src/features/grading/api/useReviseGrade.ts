/**
 * useReviseGrade — Story 6.1 (AC6/AC16). POSTs a revise + re-release (version N+1)
 * for an already-graded submission. Not optimistic; invalidates the grading read +
 * queue on settle. A concurrent-revise loser surfaces as a 409 ApiError the caller
 * can retry.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'
import type { Grade } from './useGradeSubmission'

export type ReviseGradeInput = components['schemas']['ReviseGradeInput']

/**
 * Revise + re-release the grade for submission `submissionId`.
 */
export function useReviseGrade(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<Grade, ApiError, ReviseGradeInput>({
    mutationKey: gradingKeys.reviseMutation(submissionId),
    mutationFn: (body) =>
      apiFetch<Grade>(`/api/submissions/${encodeURIComponent(submissionId)}/grade/revise`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gradingKeys.detail(submissionId) })
      queryClient.invalidateQueries({ queryKey: gradingKeys.all })
    },
  })
}
