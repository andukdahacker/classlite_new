/**
 * useGradingSubmission — Story 6.1 (AC8/AC12). Reads the teacher grading view
 * (full submission + assignment + student + exercise + current grade) via
 * `GET /api/submissions/{id}/grading`. Distinct from the student attempt bundle
 * (wrong principal, strips content). 401 stays in the fetch layer (TS-5/8).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { gradingKeys } from './gradingKeys'

export type TeacherGradingView = components['schemas']['TeacherGradingView']

const STALE_TIME_MS = 30 * 1000

/**
 * Fetch the teacher grading view for `submissionId`.
 * @param submissionId the submission to grade; the query is disabled while nullish.
 */
export function useGradingSubmission(submissionId: string | null | undefined) {
  return useQuery<TeacherGradingView, ApiError>({
    queryKey: gradingKeys.detail(submissionId ?? '__missing__'),
    queryFn: () =>
      apiFetch<TeacherGradingView>(
        `/api/submissions/${encodeURIComponent(submissionId ?? '')}/grading`,
      ),
    enabled: Boolean(submissionId),
    staleTime: STALE_TIME_MS,
    retry: false,
  })
}
