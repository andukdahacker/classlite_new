/**
 * useReviseSpeakingGrade — Story 6.3a (AC8). POSTs a speaking revise + re-release
 * (version N+1) to the skill-branched `POST /api/submissions/{id}/grade/revise`. Not
 * optimistic; invalidates the grading read + queue on settle. Mirrors useReviseGrade.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'
import type { Grade } from './useGradeSubmission'

export type ReviseSpeakingGradeInput = components['schemas']['ReviseSpeakingGradeInput']

/** Revise + re-release the speaking grade for submission `submissionId`. */
export function useReviseSpeakingGrade(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<Grade, ApiError, ReviseSpeakingGradeInput>({
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
