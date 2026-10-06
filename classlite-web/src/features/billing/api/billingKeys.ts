/**
 * billingKeys — TS-3 query-key factory for the Billing feature (Story 9-1b;
 * extended in 9-2b).
 *
 * Read slots: `summary()` (GET /api/billing), `plans()` (GET /api/billing/plans),
 * `addons()` (GET /api/billing/addons), and `prorationPreview(plan, cycle)`
 * (GET /api/billing/proration-preview — keyed on the target plan + cycle so each
 * upgrade target caches independently). Mutation slots (9-2b): `checkoutMutation`,
 * `downgradeMutation`, `cancelDowngradeMutation` — stable `mutationKey`s so
 * concurrent-mutation dedup and devtools inspection work (mirrors
 * `peopleKeys.*Mutation()`).
 *
 * A mutation's `onSettled` invalidates `billingKeys.summary()` to refresh live
 * usage/pending state without touching the near-static catalog, or
 * `billingKeys.all` to cascade. Mirrors the shipped `settingsKeys.ts` shape.
 */
import type { components } from '@/lib/api/client'

type PlanId = components['schemas']['BillingProrationPreview']['targetPlan']
type BillingCycle =
  components['schemas']['BillingProrationPreview']['targetBillingCycle']

export const billingKeys = {
  all: ['billing'] as const,
  summary: () => [...billingKeys.all, 'summary'] as const,
  plans: () => [...billingKeys.all, 'plans'] as const,
  addons: () => [...billingKeys.all, 'addons'] as const,
  prorationPreview: (plan: PlanId, billingCycle: BillingCycle) =>
    [...billingKeys.all, 'proration-preview', plan, billingCycle] as const,
  // Story 9.3 — the s73 grace indicator (owner+admin) + the s70 invoice history.
  grace: () => [...billingKeys.all, 'grace'] as const,
  invoices: (status: string) =>
    [...billingKeys.all, 'invoices', status] as const,
  emailInvoicesMutation: () =>
    [...billingKeys.all, 'invoices', 'email'] as const,
  checkoutMutation: () => [...billingKeys.all, 'checkout'] as const,
  downgradeMutation: () => [...billingKeys.all, 'downgrade'] as const,
  cancelDowngradeMutation: () =>
    [...billingKeys.all, 'downgrade', 'cancel'] as const,
} as const
