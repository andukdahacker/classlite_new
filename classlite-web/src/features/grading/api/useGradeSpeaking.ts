/**
 * useGradeSpeaking — Story 6.3a (AC8). POSTs the speaking grade + release to the
 * skill-branched `POST /api/submissions/{id}/grade` (server discriminates on the
 * submission's skill — SEC-7). Not optimistic (the server is authoritative on the
 * overall band + the student notification); on settle it invalidates the grading read +
 * the class queue. Mirrors useGradeSubmission.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'
import type { Grade } from './useGradeSubmission'

export type SpeakingGradeInput = components['schemas']['SpeakingGradeInput']

/** Grade + release the speaking submission `submissionId`. */
export function useGradeSpeaking(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<Grade, ApiError, SpeakingGradeInput>({
    mutationKey: gradingKeys.gradeMutation(submissionId),
    mutationFn: (body) =>
      apiFetch<Grade>(`/api/submissions/${encodeURIComponent(submissionId)}/grade`, {
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
