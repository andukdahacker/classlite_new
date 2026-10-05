/**
 * planDisplay — presentation helpers for the plan picker (Story 9-1b).
 *
 * `planDisplayName` maps a catalog plan id to its brand-name label ("Pro") — these
 * are product brand names, identical in en + vi, so they are NOT i18n keys. (The
 * 9-1b `buildTalkToUsMailto` helper was removed in 9-2b once the real
 * upgrade/downgrade modals replaced the `mailto:` placeholder — CQ-1.)
 */
import type { PlanCatalogEntry } from '../api/useBillingPlans'

type PlanId = PlanCatalogEntry['plan']

const DISPLAY_NAMES: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
}

/** planDisplayName returns the brand-name label for a plan id. */
export function planDisplayName(plan: PlanId): string {
  return DISPLAY_NAMES[plan]
}
