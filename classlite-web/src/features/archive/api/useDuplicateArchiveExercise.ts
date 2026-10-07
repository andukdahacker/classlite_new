/**
 * useDuplicateArchiveExercise — Story 10.2 (AC9). Duplicate / Edit-a-copy for an
 * archived EXERCISE. PURE REUSE (Ducdo D3/DD3): calls the shipped
 * `POST /api/exercises/{id}/duplicate` (201 → the full new Exercise with its id)
 * via the exercises barrel — NO net-new duplicate backend, NO fork of the
 * endpoint. The ONLY archive-specific behavior is invalidating the archive list
 * alongside the exercise lists on settle so the clone surfaces in both places
 * (DD4). Duplicate vs Edit-a-copy differ only in the caller's onSuccess
 * (toast-and-stay vs navigate-to-editor) — the mutation is identical.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  exerciseKeys,
  useDuplicateExercise,
  type Exercise,
} from '@/features/exercises'
import type { ApiError } from '@/lib/api-fetch'

import { archiveKeys } from './archiveKeys'

/**
 * Wraps the shipped exercise-duplicate mutation and additionally invalidates the
 * archive lists on settle. Returns the same mutation surface (mutate/isPending);
 * the 201 `Exercise` is passed to the caller's onSuccess for the Edit-a-copy
 * navigate.
 */
export function useDuplicateArchiveExercise() {
  const queryClient = useQueryClient()
  const base = useDuplicateExercise()

  return useMutation<Exercise, ApiError, string>({
    mutationFn: (id) => base.mutateAsync(id),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: archiveKeys.lists() })
      queryClient.invalidateQueries({ queryKey: exerciseKeys.lists() })
    },
  })
}
