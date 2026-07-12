/**
 * useListTemplates — Story 2-3b Task 3.1 / AC2.
 *
 * `GET /api/templates` — returns the wire-format `Template[]` (envelope
 * unwrapped by `apiFetch` per TS-4).
 *
 * - `staleTime: 60_000` (per spec — system seeds are near-immutable).
 * - Retry gate: 5xx only, `SEED_INCOMPLETE` excluded because retrying will
 *   keep failing until the operator finishes seed migration (Sally-I3 fold).
 * - Tenant-cache leak (Murat-S8): the query key `onboardingKeys.templates()`
 *   is NOT tenant-scoped. Auth transitions (logout / boot-probe on session
 *   change) MUST evict `onboardingKeys.all` so a stale-window user B cannot
 *   see cached user A center-owned rows. The eviction lives at the auth-flow
 *   layer; the test at `useListTemplates.test.tsx` verifies the contract
 *   holds — this hook does not manage eviction itself.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { onboardingKeys } from './onboardingKeys'

export type Template = components['schemas']['Template']
export type ListTemplatesResult = components['schemas']['ListTemplatesResult']

export const TEMPLATES_STALE_TIME_MS = 60_000

export function useListTemplates() {
  return useQuery({
    queryKey: onboardingKeys.templates(),
    queryFn: async (): Promise<Template[]> => {
      const result = await apiFetch<ListTemplatesResult>('/api/templates')
      return result.templates
    },
    staleTime: TEMPLATES_STALE_TIME_MS,
    retry: (failureCount, error) => {
      if (!(error instanceof ApiError)) return false
      if (error.status < 500) return false
      if (error.code === 'SEED_INCOMPLETE') return false
      return failureCount < 1
    },
  })
}
