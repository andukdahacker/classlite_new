/**
 * useTemplate — Story 3.3 (AC3). GET /api/templates/{id} → the template detail
 * (scalars + usedCount + ordered sessions[] with duration). Surfaces `ApiError`
 * UNCHANGED so the detail page (s20) + the picker preview can branch on
 * `err instanceof ApiError && err.status === 404` (TEMPLATE_NOT_FOUND — absent /
 * soft-deleted / cross-tenant, identical surface, no leak). Read-only.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { templateKeys } from './templateKeys'

export type TemplateDetailWire = components['schemas']['TemplateDetail']
export type TemplateSessionWire = components['schemas']['TemplateSession']

const STALE_TIME_MS = 30 * 1000

export function useTemplate(id: string | null | undefined) {
  return useQuery({
    queryKey: templateKeys.detail(id ?? '__missing__'),
    queryFn: () => apiFetch<TemplateDetailWire>(`/api/templates/${id}`),
    enabled: Boolean(id),
    staleTime: STALE_TIME_MS,
  })
}
