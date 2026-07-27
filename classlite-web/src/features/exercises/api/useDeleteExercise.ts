/**
 * useDeleteExercise — Story 4.1 (AC5). DELETE /api/exercises/{id} (SOFT delete)
 * → 204. Optimistic list-removal across every cached list slot the exercise
 * appears in, with literal-snapshot rollback on error (FW-2 optimistic triple).
 * The list cache holds `ExerciseListResult` objects, so the removal maps over
 * `result.items`. onSettled invalidates the lists + drops the detail cache.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { exerciseKeys } from './exercisesKeys'
import type { ExerciseListResult } from './useExercises'

interface DeleteContext {
  snapshots: Array<[QueryKey, ExerciseListResult | undefined]>
}

export function useDeleteExercise(id: string) {
  const queryClient = useQueryClient()

  return useMutation<void, ApiError, void, DeleteContext>({
    mutationKey: exerciseKeys.deleteMutation(id),
    mutationFn: () =>
      apiFetch<void>(`/api/exercises/${id}`, { method: 'DELETE' }),
    onMutate: async () => {
      const listKeys = queryClient
        .getQueryCache()
        .findAll({ queryKey: exerciseKeys.lists() })
        .map((q) => q.queryKey)

      await Promise.all(
        listKeys.map((key) => queryClient.cancelQueries({ queryKey: key })),
      )

      const snapshots = listKeys.map(
        (key) =>
          [key, queryClient.getQueryData<ExerciseListResult>(key)] as [
            QueryKey,
            ExerciseListResult | undefined,
          ],
      )

      for (const [key, data] of snapshots) {
        if (!data) continue
        const removed = data.items.find((ex) => ex.id === id)
        // Decrement total + the removed row's skill count alongside the item
        // removal (CR-4-1-22) so the "Showing n of total" footer and the
        // count-tab strip stay consistent during the optimistic window (and no
        // empty-table flash when the deleted row was the only one on the page).
        queryClient.setQueryData<ExerciseListResult>(key, {
          ...data,
          items: data.items.filter((ex) => ex.id !== id),
          pagination: removed
            ? { ...data.pagination, total: Math.max(0, data.pagination.total - 1) }
            : data.pagination,
          skillCounts: removed
            ? data.skillCounts.map((sc) =>
                sc.skill === removed.skill
                  ? { ...sc, count: Math.max(0, sc.count - 1) }
                  : sc,
              )
            : data.skillCounts,
        })
      }

      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: exerciseKeys.lists() })
      queryClient.removeQueries({ queryKey: exerciseKeys.detail(id) })
    },
  })
}
