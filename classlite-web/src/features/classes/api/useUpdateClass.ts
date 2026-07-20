/**
 * useUpdateClass — Story 3.1 (AC6). PATCH /api/classes/{id} partial update.
 * Invalidates every list scope + the detail entry.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { classesKeys } from './classesKeys'
import type { ClassWire } from './useClasses'

export type UpdateClassRequest = components['schemas']['UpdateClassRequest']

export function useUpdateClass() {
  const queryClient = useQueryClient()
  return useMutation<ClassWire, ApiError, { id: string; body: UpdateClassRequest }>({
    mutationFn: ({ id, body }) =>
      apiFetch<ClassWire>(`/api/classes/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: (_data, _err, { id }) => {
      queryClient.invalidateQueries({ queryKey: classesKeys.lists() })
      queryClient.invalidateQueries({ queryKey: classesKeys.detail(id) })
    },
  })
}
