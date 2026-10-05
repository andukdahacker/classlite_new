/**
 * useProrationPreview — the Polar-verbatim proration breakdown for an upgrade
 * target (Story 9-2b, AC1). `GET /api/billing/proration-preview?plan=&billingCycle=`
 * returns `BillingProrationPreview` (integer VND, computed server/Polar-side —
 * the FE renders it as-is and never recomputes, D6/D25).
 *
 * Keyed on `(plan, billingCycle)` so each target caches independently. `enabled`
 * gates the fetch to when the upgrade modal is open with a chosen target (both
 * params required by the endpoint). `staleTime` is SHORT (10s) — a proration
 * charge is time-sensitive (it depends on days remaining in the period), so a
 * stale preview could under/over-state today's charge (FW-3 — explicit, justified
 * deviation below the 30s project default toward fresher).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type BillingProrationPreview =
  components['schemas']['BillingProrationPreview']
type PlanId = BillingProrationPreview['targetPlan']
type BillingCycle = BillingProrationPreview['targetBillingCycle']

const PRORATION_STALE_TIME_MS = 10_000

/**
 * useProrationPreview fetches the proration breakdown for a target plan + cycle.
 * Pass `enabled: false` (or leave the modal closed) to keep it from firing.
 */
export function useProrationPreview(
  plan: PlanId,
  billingCycle: BillingCycle,
  enabled: boolean,
) {
  return useQuery<BillingProrationPreview, ApiError>({
    queryKey: billingKeys.prorationPreview(plan, billingCycle),
    queryFn: () =>
      apiFetch<BillingProrationPreview>(
        `/api/billing/proration-preview?plan=${plan}&billingCycle=${billingCycle}`,
      ),
    enabled,
    staleTime: PRORATION_STALE_TIME_MS,
  })
}
