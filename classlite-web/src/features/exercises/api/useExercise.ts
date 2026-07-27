/**
 * useExercise — Story 4.1 single-exercise detail (AC6). Includes the full
 * `content` blob + counts. Used by the edit dialog for a fresh `updatedAt`
 * precondition. Not mounted on the list page (the list carries lighter items).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { exerciseKeys } from './exercisesKeys'

export type Exercise = components['schemas']['Exercise']

const STALE_TIME_MS = 30 * 1000

export function useExercise(id: string | null | undefined) {
  return useQuery({
    queryKey: id ? exerciseKeys.detail(id) : exerciseKeys.detail('__disabled__'),
    queryFn: () => apiFetch<Exercise>(`/api/exercises/${id}`),
    enabled: Boolean(id),
    staleTime: STALE_TIME_MS,
  })
}
