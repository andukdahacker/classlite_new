/**
 * Staff Owner-action + invite mutations — Story 7.1b (AC11-18). Thin wrappers
 * over the 7-1a endpoints, each `useMutation<TData, ApiError, TInput>` with
 * invalidate-on-settled (no optimistic patch — none of these four actions has a
 * cheap local-mirror that warrants the FW-2 triple; the roster/detail re-fetch
 * is authoritative). Force-logout REUSES the shipped
 * `/api/admin/users/{id}/force-logout` (D15) — no new backend.
 *
 * All request/response shapes are the generated wire types (D3); `apiFetch`
 * unwraps the envelope (TS-4). Reset-password returns 204 (no body → void).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { peopleKeys } from './peopleKeys'

export type InviteStaffRequest = components['schemas']['InviteStaffRequest']
export type InviteResult = components['schemas']['InviteResult']
export type AssignClassResult = components['schemas']['AssignClassResult']
export type ArchiveStaffResult = components['schemas']['ArchiveStaffResult']
export type ForceLogoutResult = components['schemas']['ForceLogoutResult']

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/** POST /api/centers/{centerId}/invites — widened 7-1a staff invite (AC17). */
export function useInviteStaff(centerId: string) {
  const queryClient = useQueryClient()
  return useMutation<InviteResult, ApiError, InviteStaffRequest>({
    mutationKey: peopleKeys.inviteMutation(),
    mutationFn: (body) =>
      apiFetch<InviteResult>(`/api/centers/${centerId}/invites`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      // The invitee appears under the Pending tab on the next roster read.
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffList() })
    },
  })
}

/** POST /api/staff/{userId}/assign-class — attach the member to a class (AC11). */
export function useAssignClass(userId: string) {
  const queryClient = useQueryClient()
  return useMutation<AssignClassResult, ApiError, { classId: string }>({
    mutationKey: peopleKeys.assignClassMutation(),
    mutationFn: ({ classId }) =>
      apiFetch<AssignClassResult>(`/api/staff/${userId}/assign-class`, {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify({ classId }),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffDetail(userId) })
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffList() })
    },
  })
}

/** POST /api/staff/{userId}/archive — soft-archive the member (AC12). */
export function useArchiveStaff(userId: string) {
  const queryClient = useQueryClient()
  return useMutation<ArchiveStaffResult, ApiError, void>({
    mutationKey: peopleKeys.archiveMutation(),
    mutationFn: () =>
      apiFetch<ArchiveStaffResult>(`/api/staff/${userId}/archive`, {
        method: 'POST',
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffDetail(userId) })
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffList() })
    },
  })
}

/** POST /api/staff/{userId}/reset-password — 204, no body (AC13). */
export function useResetStaffPassword(userId: string) {
  return useMutation<void, ApiError, void>({
    mutationKey: peopleKeys.resetPasswordMutation(),
    mutationFn: () =>
      apiFetch<void>(`/api/staff/${userId}/reset-password`, { method: 'POST' }),
  })
}

/** POST /api/admin/users/{userId}/force-logout — reused shipped endpoint (AC14). */
export function useForceLogout(userId: string) {
  const queryClient = useQueryClient()
  return useMutation<ForceLogoutResult, ApiError, void>({
    mutationKey: peopleKeys.forceLogoutMutation(),
    mutationFn: () =>
      apiFetch<ForceLogoutResult>(`/api/admin/users/${userId}/force-logout`, {
        method: 'POST',
      }),
    onSuccess: () => {
      // Force-logout snaps lastActiveAt to null (D15) — re-read to reflect it.
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffDetail(userId) })
      queryClient.invalidateQueries({ queryKey: peopleKeys.staffList() })
    },
  })
}
