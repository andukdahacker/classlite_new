/**
 * useDeleteTemplate — Story 3.3 (AC4). DELETE /api/templates/{id} (soft delete)
 * → 204. Optimistic list-removal across every cached `list(...)` slot the
 * template appears in, with literal-snapshot rollback on error (FW-2). onSettled
 * invalidates the lists and drops the detail cache for the archived id.
 */
import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { onboardingKeys } from '@/features/onboarding'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { templateKeys } from './templateKeys'
import type { TemplateWire } from './useTemplates'

interface DeleteContext {
  snapshots: Array<[QueryKey, TemplateWire[] | undefined]>
}

export function useDeleteTemplate(id: string) {
  const queryClient = useQueryClient()

  return useMutation<void, ApiError, void, DeleteContext>({
    mutationKey: templateKeys.deleteMutation(id),
    mutationFn: () =>
      apiFetch<void>(`/api/templates/${id}`, { method: 'DELETE' }),
    onMutate: async () => {
      const listKeys = queryClient
        .getQueryCache()
        .findAll({ queryKey: templateKeys.lists() })
        .map((q) => q.queryKey)

      await Promise.all(
        listKeys.map((key) => queryClient.cancelQueries({ queryKey: key })),
      )

      const snapshots = listKeys.map(
        (key) =>
          [key, queryClient.getQueryData<TemplateWire[]>(key)] as [
            QueryKey,
            TemplateWire[] | undefined,
          ],
      )

      for (const [key, data] of snapshots) {
        if (!data) continue
        queryClient.setQueryData<TemplateWire[]>(
          key,
          data.filter((tpl) => tpl.id !== id),
        )
      }

      return { snapshots }
    },
    onError: (_err, _vars, ctx) => {
      ctx?.snapshots.forEach(([key, data]) => {
        queryClient.setQueryData(key, data)
      })
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
      queryClient.removeQueries({ queryKey: templateKeys.detail(id) })
      // CR-3-3 fix — drop the archived template from the class-create dialog
      // picker (separate onboarding cache) instead of offering a soft-deleted row.
      queryClient.invalidateQueries({ queryKey: onboardingKeys.templates() })
    },
  })
}
