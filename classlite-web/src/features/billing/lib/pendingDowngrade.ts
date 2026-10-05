/**
 * pendingDowngrade — normalize the TWO wire shapes a scheduled downgrade arrives
 * in (Story 9-2b, AC6 / contract gotcha #2) into ONE `PendingDowngrade | null`.
 *
 *   - `GET /api/billing` → `BillingSummary.pendingDowngrade`:
 *       `{ plan, effectiveAt } | null`  (null-when-none)
 *   - `POST /api/billing/downgrade` and `.../cancel` →
 *       `{ pendingPlan, pendingBillingCycle, effectiveAt }`
 *       (**empty-string `""`, not null, when none**)
 *
 * Treating `pendingPlan === ""` (or null) as "none" is the load-bearing rule — the
 * endpoint never returns null for an absent downgrade. Both callers go through
 * these two adapters so no component hand-rolls the empty-string check.
 */
import type { components } from '@/lib/api/client'

type PlanId = components['schemas']['BillingPendingDowngrade']['plan']
type SummaryPending = components['schemas']['BillingSummary']['pendingDowngrade']
type EndpointPending =
  components['schemas']['EnvelopeBillingPendingDowngrade']['data']

/** The one normalized shape every billing surface renders. */
export interface PendingDowngrade {
  plan: PlanId
  /** ISO date-time of the renewal boundary the downgrade applies at. */
  effectiveAt: string
}

const PLAN_IDS: readonly PlanId[] = ['free', 'pro', 'studio']

function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value)
}

/** normalizeSummaryPending adapts `BillingSummary.pendingDowngrade` (null-when-none). */
export function normalizeSummaryPending(
  pending: SummaryPending,
): PendingDowngrade | null {
  if (!pending) return null
  // Defend symmetrically with normalizeEndpointPending: a contract-slip shape
  // (empty-string or off-enum `plan`) must normalize to "none" rather than render
  // "Downgrade to undefined …". The two wire shapes disagreeing on "none" is the
  // whole reason this module exists.
  if (!isPlanId(pending.plan)) return null
  return { plan: pending.plan, effectiveAt: pending.effectiveAt ?? '' }
}

/**
 * normalizeEndpointPending adapts the downgrade/cancel endpoint shape, where an
 * absent downgrade is the empty string `""` (NOT null) on every field.
 */
export function normalizeEndpointPending(
  pending: EndpointPending,
): PendingDowngrade | null {
  const plan = pending.pendingPlan
  if (!plan || !isPlanId(plan)) return null
  return { plan, effectiveAt: pending.effectiveAt ?? '' }
}
