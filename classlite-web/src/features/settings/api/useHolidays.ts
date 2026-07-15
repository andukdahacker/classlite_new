/**
 * useHolidays + useMutateHoliday — Story 2-5b. Same shape as useTerms.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'

export type Holiday = components['schemas']['Holiday']
export type CreateHolidayRequest = components['schemas']['CreateHolidayRequest']
export type UpdateHolidayRequest = components['schemas']['UpdateHolidayRequest']

const STALE_TIME_MS = 60 * 1000

export function useHolidays(centerId: string | null | undefined) {
  return useQuery({
    queryKey: centerId
      ? settingsKeys.holidays(centerId)
      : [...settingsKeys.all, 'holidays', '__disabled__'],
    queryFn: () => apiFetch<Holiday[]>('/api/holidays'),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}

export type HolidayMutationInput =
  | { kind: 'create'; body: CreateHolidayRequest }
  | { kind: 'update'; id: string; body: UpdateHolidayRequest }
  | { kind: 'delete'; id: string }

interface OptimisticContext {
  previous: Holiday[] | undefined
}

export function useMutateHoliday(centerId: string) {
  const queryClient = useQueryClient()
  const listKey = settingsKeys.holidays(centerId)

  return useMutation<
    Holiday | null,
    Error,
    HolidayMutationInput,
    OptimisticContext
  >({
    mutationFn: async (input) => {
      switch (input.kind) {
        case 'create':
          return apiFetch<Holiday>('/api/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'update':
          return apiFetch<Holiday>(`/api/holidays/${input.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'delete':
          await apiFetch<void>(`/api/holidays/${input.id}`, {
            method: 'DELETE',
          })
          return null
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey })
      return { previous: queryClient.getQueryData<Holiday[]>(listKey) }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(listKey, ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: listKey })
    },
  })
}
