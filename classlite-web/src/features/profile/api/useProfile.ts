/**
 * useProfile — Story 9.4 GET /api/users/me (AC6 / D1).
 *
 * staleTime 30s (FW-3 project default) — the profile page is not bursty, but
 * the explicit value satisfies the no-staleTime-0 rule. The query fn unwraps
 * the `{data}` envelope via apiFetch (TS-4).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { profileKeys } from './profileKeys'

export type UserProfile = components['schemas']['UserProfile']
export type NotificationSettings = components['schemas']['NotificationSettings']

const STALE_TIME_MS = 30 * 1000

export function useProfile() {
  return useQuery({
    queryKey: profileKeys.me(),
    queryFn: () => apiFetch<UserProfile>('/api/users/me'),
    staleTime: STALE_TIME_MS,
  })
}
