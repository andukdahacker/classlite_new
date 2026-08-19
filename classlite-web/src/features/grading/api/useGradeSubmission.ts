/**
 * useGradeSubmission — Story 6.1 (AC4/AC16). POSTs the grade + release. Release is
 * NOT optimistic (AC16 — it awaits the server, which is authoritative on the overall
 * band + the student notification); on settle it invalidates the grading read + the
 * class queue so both reflect the released grade.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'

export type GradeInput = components['schemas']['GradeInput']
export type Grade = components['schemas']['Grade']

/**
 * Grade + release submission `submissionId`.
 */
export function useGradeSubmission(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<Grade, ApiError, GradeInput>({
    mutationKey: gradingKeys.gradeMutation(submissionId),
    mutationFn: (body) =>
      apiFetch<Grade>(`/api/submissions/${encodeURIComponent(submissionId)}/grade`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: gradingKeys.detail(submissionId) })
      // Broad queue invalidation (the mutation does not carry class/assignment ids).
      queryClient.invalidateQueries({ queryKey: gradingKeys.all })
    },
  })
}
