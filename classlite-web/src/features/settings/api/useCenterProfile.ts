/**
 * useCenterProfile — Story 2-5a AC1/AC4 GET /api/centers/{id}.
 *
 * staleTime 60s per FW-3 default guidance for settings-type screens
 * (tab-switching is bursty; a 60s window covers a typical Owner tabbing
 * across Profile → Terms → Rooms without re-fetching).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'

export type CenterProfile = components['schemas']['CenterProfile']

const STALE_TIME_MS = 60 * 1000

export function useCenterProfile(centerId: string | null | undefined) {
  return useQuery({
    queryKey: centerId
      ? settingsKeys.centerProfile(centerId)
      : settingsKeys.centerProfileDisabled(),
    queryFn: () => apiFetch<CenterProfile>(`/api/centers/${centerId!}`),
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
  })
}
