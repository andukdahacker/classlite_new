/**
 * useOverrideAutoGradeAnswer — Story 6.4b (AC8/AC9, D2/D5). POSTs a single teacher
 * override to `POST /api/submissions/{id}/auto-grade/overrides` and returns the FULL
 * recomputed objective breakdown (the server is authoritative on scoring — D3, the UI
 * never recomputes). Mirrors useGradeSpeaking's apiFetch shape but NOT its invalidation
 * set (D2/Winston):
 *   - onSuccess SEEDS `gradingKeys.detail` with the recomputed AutoGradeView so the
 *     After-overrides score updates BEFORE the invalidation refetch resolves (AC8). The
 *     seed is on-success ONLY — a failed override leaves the prior view standing, no
 *     dangling write (AC9).
 *   - onSettled invalidates `gradingKeys.detail(submissionId)` ONLY — an override does
 *     NOT change queue membership (the submission stays un-released, still in the queue),
 *     so invalidating `all` would spuriously refetch the queue on every single-click.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'
import type { TeacherGradingView } from './useGradingSubmission'

export type AutoGradeView = components['schemas']['AutoGradeView']
export type OverrideAutoGradeAnswerRequest =
  components['schemas']['OverrideAutoGradeAnswerRequest']

/** Override one objective answer's mark on submission `submissionId`. */
export function useOverrideAutoGradeAnswer(submissionId: string) {
  const queryClient = useQueryClient()
  return useMutation<AutoGradeView, ApiError, OverrideAutoGradeAnswerRequest>({
    mutationKey: gradingKeys.overrideMutation(submissionId),
    retry: false,
    mutationFn: (body) =>
      apiFetch<AutoGradeView>(
        `/api/submissions/${encodeURIComponent(submissionId)}/auto-grade/overrides`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      ),
    onSuccess: (data) => {
      // Seed the recomputed breakdown so the summary band + rows update without waiting
      // for the invalidation refetch (AC8). Only touch an existing view — never create one.
      queryClient.setQueryData<TeacherGradingView>(gradingKeys.detail(submissionId), (prev) =>
        prev ? { ...prev, autoGrade: data } : prev,
      )
    },
    onSettled: () => {
      // D2: detail ONLY — an override does not change queue membership.
      queryClient.invalidateQueries({ queryKey: gradingKeys.detail(submissionId) })
    },
  })
}
