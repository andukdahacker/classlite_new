/**
 * planDisplay — presentation helpers for the plan picker (Story 9-1b).
 *
 * `planDisplayName` maps a catalog plan id to its brand-name label ("Pro") —
 * these are product brand names, identical in en + vi, so they are NOT i18n
 * keys. `buildTalkToUsMailto` composes the D-9-1b-1 email contact action: the
 * picker's non-current-tier CTA is a `mailto:` (capture the most-motivated
 * upgrade moment as a human conversation), never a dead "Upgrade" button
 * (purchase is 9.2).
 */
import type { PlanCatalogEntry } from '../api/useBillingPlans'

type PlanId = PlanCatalogEntry['plan']

/** The center-support inbox the "Talk to us" CTA opens (D-9-1b-1). */
export const SUPPORT_EMAIL = 'hello@classlite.app'

const DISPLAY_NAMES: Record<PlanId, string> = {
  free: 'Free',
  pro: 'Pro',
  studio: 'Studio',
}

/** planDisplayName returns the brand-name label for a plan id. */
export function planDisplayName(plan: PlanId): string {
  return DISPLAY_NAMES[plan]
}

/** buildTalkToUsMailto builds the `mailto:` href for a tier's contact CTA. */
export function buildTalkToUsMailto(plan: PlanId): string {
  const tier = planDisplayName(plan)
  const subject = encodeURIComponent(`ClassLite — ${tier} plan`)
  return `mailto:${SUPPORT_EMAIL}?subject=${subject}`
}
