/**
 * useStaffRoster / useStaffMemberDetail — Story 7.1b (AC3/AC8). Component-level
 * reads of the staff surface shipped by 7-1a. Per D2 the app has ZERO
 * loader-prefetch usage; this follows the shipped `useClasses` convention
 * (component `useQuery` + the UX-1 trilogy owned by the consuming page).
 *
 * Both consume the generated wire types verbatim (D3); `apiFetch` unwraps the
 * `{ data }` envelope so the page receives the INNER type (TS-4).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { peopleKeys } from './peopleKeys'

export type StaffRoster = components['schemas']['StaffRoster']
export type StaffMember = components['schemas']['StaffMember']
export type PendingInvite = components['schemas']['PendingInvite']
export type StaffMemberDetail = components['schemas']['StaffMemberDetail']
export type StaffLoad = components['schemas']['StaffLoad']

const STALE_TIME_MS = 60 * 1000

/** GET /api/staff — the tenant-scoped roster (members + pendingInvites). */
export function useStaffRoster() {
  return useQuery({
    queryKey: peopleKeys.staffList(),
    queryFn: () => apiFetch<StaffRoster>('/api/staff'),
    staleTime: STALE_TIME_MS,
  })
}

/** GET /api/staff/{userId} — a single member's detail; disabled without an id. */
export function useStaffMemberDetail(userId: string | undefined) {
  return useQuery({
    queryKey: peopleKeys.staffDetail(userId ?? '__none__'),
    queryFn: () => apiFetch<StaffMemberDetail>(`/api/staff/${userId}`),
    enabled: Boolean(userId),
    staleTime: STALE_TIME_MS,
  })
}
