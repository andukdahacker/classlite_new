/**
 * useTeacherSubmissionAudioUrl — Story 6.3a (AC2/D5). On-demand re-sign of a speaking
 * submission's audio for the teacher grading player, via the CLASS/ASSIGNMENT/SUBMISSION
 * -keyed teacher route `GET /api/classes/{classId}/grading/{assignmentId}/{submissionId}/audio`
 * (distinct from the submission-keyed grading READ — the refresh needs the class scope
 * for teacher-of-class authz). Returns an imperative `refresh()` the AudioWaveformPlayer
 * calls when the inline URL ages past ~4 min or 404s mid-session.
 */
import { useCallback } from 'react'
import { apiFetch } from '@/lib/api-fetch'

/** A fresh 5-min presigned GET for the recording (teacher-of-class scoped). */
export function useTeacherSubmissionAudioUrl(
  classId: string,
  assignmentId: string,
  submissionId: string,
) {
  const refresh = useCallback(async (): Promise<string> => {
    const result = await apiFetch<{ url: string }>(
      `/api/classes/${encodeURIComponent(classId)}/grading/${encodeURIComponent(
        assignmentId,
      )}/${encodeURIComponent(submissionId)}/audio`,
    )
    return result.url
  }, [classId, assignmentId, submissionId])

  return { refresh }
}
