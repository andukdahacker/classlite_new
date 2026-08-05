/**
 * useSubmitAttempt — Story 5.2b (AC13/AC14/AC18). The finalizing POST:
 * `POST /api/submissions/{id}/submit` — NO body → `Submission`.
 *
 * This is the raw submit mutation. It is NOT called directly by the UI; the
 * serialized finalizer (`finalizeAttempt`, AC18) composes it AFTER the latest
 * autosave flush has acked, so answers are never lost to a submit that races an
 * in-flight PUT. A 409 (`SUBMISSION_NOT_EDITABLE` / `SUBMISSION_LOCKED`) is
 * treated by the finalizer as already-final (idempotent, AC19), not an error.
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { attemptKeys } from './attemptKeys'

type Submission = components['schemas']['Submission']

/**
 * The finalizing submit for a submission.
 * @param submissionId the submission to finalize.
 * @returns a TanStack mutation whose `mutateAsync()` resolves to the finalized
 *   `Submission`.
 */
export function useSubmitAttempt(submissionId: string) {
  return useMutation({
    mutationKey: attemptKeys.submitMutation(submissionId),
    mutationFn: async (): Promise<Submission> => {
      return apiFetch<Submission>(
        `/api/submissions/${submissionId}/submit`,
        { method: 'POST' },
      )
    },
  })
}
