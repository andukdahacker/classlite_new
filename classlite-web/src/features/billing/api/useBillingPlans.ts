/**
 * useBillingPlans — the plan catalog (Story 9-1b, AC17). Feeds the plan picker
 * s68. `GET /api/billing/plans` returns `{ data: { plans: [] }, meta }`;
 * `apiFetch` unwraps the envelope (TS-4) so this hook resolves to
 * `{ plans: PlanCatalogEntry[] }`.
 *
 * The catalog is near-static (prices are CI-locked constants, D25) so a long
 * `staleTime` (1h) avoids needless refetches (FW-3).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type PlanCatalogEntry = components['schemas']['PlanCatalogEntry']

interface PlanCatalog {
  plans: PlanCatalogEntry[]
}

const PLANS_STALE_TIME_MS = 60 * 60 * 1000

/** useBillingPlans fetches `GET /api/billing/plans` → `{ plans: PlanCatalogEntry[] }`. */
export function useBillingPlans() {
  return useQuery<PlanCatalog, ApiError>({
    queryKey: billingKeys.plans(),
    queryFn: () => apiFetch<PlanCatalog>('/api/billing/plans'),
    staleTime: PLANS_STALE_TIME_MS,
  })
}
