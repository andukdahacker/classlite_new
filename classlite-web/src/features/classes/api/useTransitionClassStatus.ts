/**
 * useTransitionClassStatus — Story 3.1 (AC4/AC8). POST /api/classes/{id}/status
 * with the FW-2 optimistic triple, EXTENDED across audiences: a class can live
 * in multiple cached `list(...)` scopes (owner 'all' + the assigned teacher's
 * 'teacher:<id>'), so onMutate patches every cached list entry and onError
 * rolls each back to its LITERAL prior snapshot.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { classesKeys } from './classesKeys'
import type { ClassStatus, ClassWire } from './useClasses'

interface TransitionInput {
  id: string
  status: ClassStatus
}

interface TransitionContext {
  snapshots: Array<[QueryKey, ClassWire[] | undefined]>
}

export function useTransitionClassStatus(centerId: string) {
  const queryClient = useQueryClient()
  void centerId // scope-agnostic: patches every cached list, not one center slot

  return useMutation<ClassWire, ApiError, TransitionInput, TransitionContext>({
    mutationFn: ({ id, status }) =>
      apiFetch<ClassWire>(`/api/classes/${id}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onMutate: async ({ id, status }) => {
      const listKeys = queryClient
        .getQueryCache()
        .findAll({ queryKey: classesKeys.lists() })
        .map((q) => q.queryKey)

      await Promise.all(
        listKeys.map((key) => queryClient.cancelQueries({ queryKey: key })),
      )

      const snapshots = listKeys.map(
        (key) =>
          [key, queryClient.getQueryData<ClassWire[]>(key)] as [
            QueryKey,
            ClassWire[] | undefined,
          ],
      )

      for (const [key, data] of snapshots) {
        if (!data) continue
        queryClient.setQueryData<ClassWire[]>(
          key,
          data.map((c) => (c.id === id ? { ...c, status } : c)),
        )
      }

      return { snapshots }
    },
    onError: (_err, _input, ctx) => {
      // Snap back to the LITERAL prior status/color for every patched scope.
      ctx?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: classesKeys.lists() })
    },
  })
}
