/**
 * useRooms + useMutateRoom — Story 2-5b. Same shape as useTerms.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'

export type Room = components['schemas']['Room']
export type CreateRoomRequest = components['schemas']['CreateRoomRequest']
export type UpdateRoomRequest = components['schemas']['UpdateRoomRequest']

const STALE_TIME_MS = 60 * 1000

export function useRooms(centerId: string | null | undefined) {
  return useQuery({
    queryKey: centerId
      ? settingsKeys.rooms(centerId)
      : [...settingsKeys.all, 'rooms', '__disabled__'],
    queryFn: () => apiFetch<Room[]>('/api/rooms'),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}

export type RoomMutationInput =
  | { kind: 'create'; body: CreateRoomRequest }
  | { kind: 'update'; id: string; body: UpdateRoomRequest }
  | { kind: 'delete'; id: string }

interface OptimisticContext {
  previous: Room[] | undefined
}

export function useMutateRoom(centerId: string) {
  const queryClient = useQueryClient()
  const listKey = settingsKeys.rooms(centerId)

  return useMutation<Room | null, Error, RoomMutationInput, OptimisticContext>({
    mutationFn: async (input) => {
      switch (input.kind) {
        case 'create':
          return apiFetch<Room>('/api/rooms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'update':
          return apiFetch<Room>(`/api/rooms/${input.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'delete':
          await apiFetch<void>(`/api/rooms/${input.id}`, { method: 'DELETE' })
          return null
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey })
      return { previous: queryClient.getQueryData<Room[]>(listKey) }
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
