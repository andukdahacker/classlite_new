/**
 * useTemplates — Story 3.3 (AC1/AC2). GET /api/templates → the dual-scope
 * catalog (system seeds + own center) with per-row `usedCount`. Keyed by
 * `templateKeys.list(centerId)` so audiences don't share a slot; disabled until
 * a center is known.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { templateKeys } from './templateKeys'

export type TemplateWire = components['schemas']['Template']
export type TemplateListResult = components['schemas']['ListTemplatesResult']

const STALE_TIME_MS = 30 * 1000

export function useTemplates(centerId: string | null | undefined) {
  return useQuery({
    queryKey: centerId
      ? templateKeys.list(centerId)
      : templateKeys.listDisabled(),
    queryFn: async (): Promise<TemplateWire[]> => {
      const result = await apiFetch<TemplateListResult>('/api/templates')
      return result.templates
    },
    enabled: Boolean(centerId),
    staleTime: STALE_TIME_MS,
    retry: (failureCount, error) => {
      if (!(error instanceof ApiError)) return false
      if (error.status < 500) return false
      return failureCount < 1
    },
  })
}
