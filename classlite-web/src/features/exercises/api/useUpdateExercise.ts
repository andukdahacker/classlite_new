/**
 * useUpdateExercise — Story 4.1 (AC4). PATCH /api/exercises/{id} → 200. Carries
 * the optimistic-concurrency `updatedAt` precondition (the server rejects a
 * stale one with 409, a missing one with 428). 4.1's metadata dialog sends the
 * freshly-read `updatedAt`. Invalidates lists + detail on settle.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { exerciseKeys } from './exercisesKeys'
import type { Exercise } from './useExercise'

export type UpdateExerciseRequest = components['schemas']['UpdateExerciseRequest']

export interface UpdateExerciseVars {
  id: string
  body: UpdateExerciseRequest
}

export function useUpdateExercise() {
  const queryClient = useQueryClient()
  return useMutation<Exercise, ApiError, UpdateExerciseVars>({
    mutationFn: ({ id, body }) =>
      apiFetch<Exercise>(`/api/exercises/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: (_data, _err, vars) => {
      queryClient.invalidateQueries({ queryKey: exerciseKeys.lists() })
      queryClient.invalidateQueries({ queryKey: exerciseKeys.detail(vars.id) })
    },
  })
}
