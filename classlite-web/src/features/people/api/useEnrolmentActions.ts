/**
 * Enrolment action mutation — Story 7.3b (AC6). One `useMutation` over the
 * single POST /api/enrollments action endpoint (the verb rides in the `action`
 * body field, D3/D7). Models the shipped `useStaffActions.ts` template:
 * `useMutation<TData, ApiError, TInput>` + `JSON_HEADERS` + invalidate-on-success
 * (no optimistic patch — the immutable history + capacity math are server
 * truths; mirror `useAssignClass`).
 *
 * On success the whole People tree (`peopleKeys.all` — history + attention +
 * the student roster) AND the classes cache (`classesKeys.all` — active counts
 * changed) invalidate.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { classesKeys } from '@/features/classes'
import { peopleKeys } from './peopleKeys'

export type Enrollment = components['schemas']['Enrollment']
export type EnrollmentActionRequest =
  components['schemas']['EnrollmentActionRequest']
export type EnrollmentActionType =
  components['schemas']['EnrollmentActionType']

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** POST /api/enrollments — add / transfer / withdraw (201 add, 200 otherwise). */
export function useEnrolmentAction() {
  const queryClient = useQueryClient()
  return useMutation<Enrollment, ApiError, EnrollmentActionRequest>({
    mutationKey: peopleKeys.enrolmentActionMutation(),
    mutationFn: (body) =>
      apiFetch<Enrollment>('/api/enrollments', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.all })
      queryClient.invalidateQueries({ queryKey: classesKeys.all })
    },
  })
}
