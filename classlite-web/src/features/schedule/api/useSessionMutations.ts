/**
 * Session mutations — Story 3.4. Create / update (scoped) / cancel (scoped) /
 * delete (scoped). All invalidate the range + byClass + detail caches on
 * settle (a scoped edit can touch many rows across the window, so broad
 * invalidation is correct here rather than a narrow optimistic patch — FW-2's
 * rollback triple is reserved for the single-row status toggle in Classes).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { sessionsKeys } from './sessionsKeys'
import type { ApplyScope } from './useSessions'

type CreateSessionRequest = components['schemas']['CreateSessionRequest']
type CreateSessionResult = components['schemas']['CreateSessionResult']
type UpdateSessionRequest = components['schemas']['UpdateSessionRequest']
type CancelSessionRequest = components['schemas']['CancelSessionRequest']
type SessionWire = components['schemas']['Session']

function invalidateSessions(queryClient: ReturnType<typeof useQueryClient>): void {
  queryClient.invalidateQueries({ queryKey: sessionsKeys.ranges() })
  queryClient.invalidateQueries({ queryKey: sessionsKeys.byClasses() })
  queryClient.invalidateQueries({ queryKey: sessionsKeys.details() })
}

export function useCreateSession() {
  const queryClient = useQueryClient()
  return useMutation<CreateSessionResult, ApiError, CreateSessionRequest>({
    mutationKey: sessionsKeys.createMutation(),
    mutationFn: (body) =>
      apiFetch<CreateSessionResult>('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => invalidateSessions(queryClient),
  })
}

export interface UpdateSessionVars {
  id: string
  body: UpdateSessionRequest
}

export function useUpdateSession() {
  const queryClient = useQueryClient()
  return useMutation<SessionWire, ApiError, UpdateSessionVars>({
    mutationFn: ({ id, body }) =>
      apiFetch<SessionWire>(`/api/sessions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => invalidateSessions(queryClient),
  })
}

export interface CancelSessionVars {
  id: string
  body: CancelSessionRequest
}

export function useCancelSession() {
  const queryClient = useQueryClient()
  return useMutation<SessionWire, ApiError, CancelSessionVars>({
    mutationFn: ({ id, body }) =>
      apiFetch<SessionWire>(`/api/sessions/${id}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => invalidateSessions(queryClient),
  })
}

export interface DeleteSessionVars {
  id: string
  scope: ApplyScope
  expectedUpdatedAt: string
}

export function useDeleteSession() {
  const queryClient = useQueryClient()
  return useMutation<void, ApiError, DeleteSessionVars>({
    mutationFn: ({ id, scope, expectedUpdatedAt }) => {
      const params = new URLSearchParams({ scope, expectedUpdatedAt })
      return apiFetch<void>(`/api/sessions/${id}?${params.toString()}`, { method: 'DELETE' })
    },
    onSettled: () => invalidateSessions(queryClient),
  })
}
