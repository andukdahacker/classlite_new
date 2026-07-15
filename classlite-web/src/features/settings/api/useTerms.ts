/**
 * useTerms + useMutateTerm — Story 2-5b terms CRUD hooks.
 *
 * List hook: staleTime 60s (mirrors useCenterProfile FW-3 default for
 * settings-type screens). Mutation hook is a single seam that dispatches
 * create/update/delete via method+id — full optimistic triple per FW-2.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'

export type Term = components['schemas']['Term']
export type CreateTermRequest = components['schemas']['CreateTermRequest']
export type UpdateTermRequest = components['schemas']['UpdateTermRequest']

const STALE_TIME_MS = 60 * 1000

export function useTerms(centerId: string | null | undefined) {
  return useQuery({
    queryKey: centerId
      ? settingsKeys.terms(centerId)
      : [...settingsKeys.all, 'terms', '__disabled__'],
    queryFn: () => apiFetch<Term[]>('/api/terms'),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}

export type TermMutationInput =
  | { kind: 'create'; body: CreateTermRequest }
  | { kind: 'update'; id: string; body: UpdateTermRequest }
  | { kind: 'delete'; id: string }

interface OptimisticContext {
  previous: Term[] | undefined
}

export function useMutateTerm(centerId: string) {
  const queryClient = useQueryClient()
  const listKey = settingsKeys.terms(centerId)

  return useMutation<Term | null, Error, TermMutationInput, OptimisticContext>({
    mutationFn: async (input) => {
      switch (input.kind) {
        case 'create':
          return apiFetch<Term>('/api/terms', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'update':
          return apiFetch<Term>(`/api/terms/${input.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(input.body),
          })
        case 'delete':
          await apiFetch<void>(`/api/terms/${input.id}`, { method: 'DELETE' })
          return null
      }
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: listKey })
      return { previous: queryClient.getQueryData<Term[]>(listKey) }
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
