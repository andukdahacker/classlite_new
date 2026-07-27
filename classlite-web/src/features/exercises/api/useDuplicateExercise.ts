/**
 * useDuplicateExercise — Story 4.1 (AC5). POST /api/exercises/{id}/duplicate →
 * 201. Server clones title "(copy)" + deep-copies content with a fresh code.
 * Invalidates every list scope so the clone surfaces.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { exerciseKeys } from './exercisesKeys'
import type { Exercise } from './useExercise'

export function useDuplicateExercise() {
  const queryClient = useQueryClient()
  return useMutation<Exercise, ApiError, string>({
    mutationFn: (id) =>
      apiFetch<Exercise>(`/api/exercises/${id}/duplicate`, { method: 'POST' }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: exerciseKeys.lists() })
    },
  })
}
