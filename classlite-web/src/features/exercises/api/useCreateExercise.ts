/**
 * useCreateExercise — Story 4.1 (AC3). POST /api/exercises → 201. Minimal-
 * metadata create; the server sets code + schemaVersion + the content shell.
 * Invalidates every cached list scope so the new row surfaces. (Named to avoid
 * the session-detail useCreateExercise — reach this only via
 * `@/features/exercises`; never import the session-detail hook here — T8.)
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { exerciseKeys } from './exercisesKeys'
import type { Exercise } from './useExercise'

export type CreateExerciseRequest = components['schemas']['CreateExerciseRequest']

export function useCreateExercise(centerId: string) {
  const queryClient = useQueryClient()
  return useMutation<Exercise, ApiError, CreateExerciseRequest>({
    mutationKey: exerciseKeys.createMutation(centerId),
    mutationFn: (body) =>
      apiFetch<Exercise>('/api/exercises', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: exerciseKeys.lists() })
    },
  })
}
