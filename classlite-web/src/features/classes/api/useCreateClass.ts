/**
 * useCreateClass — Story 3.1 (AC1). POST /api/classes → 201 upcoming.
 * Invalidates every cached list scope so the new row surfaces regardless of
 * which audience's list is mounted.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { classesKeys } from './classesKeys'
import type { ClassWire } from './useClasses'

export type CreateClassRequest = components['schemas']['CreateClassRequest']

export function useCreateClass(centerId: string) {
  const queryClient = useQueryClient()
  return useMutation<ClassWire, ApiError, CreateClassRequest>({
    mutationKey: classesKeys.createMutation(centerId),
    mutationFn: (body) =>
      apiFetch<ClassWire>('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: classesKeys.lists() })
    },
  })
}
