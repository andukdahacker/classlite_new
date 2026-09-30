/**
 * billingKeys — TS-3 query-key factory for the Billing feature (Story 9-1b).
 *
 * Two read slots today: `summary()` (GET /api/billing) and `plans()`
 * (GET /api/billing/plans). Structured so a 9.2 mutation (upgrade / add-on
 * purchase) can `invalidateQueries({ queryKey: billingKeys.summary() })` to
 * refresh live usage without touching the catalog, or
 * `invalidateQueries({ queryKey: billingKeys.all })` to cascade both.
 * Mirrors the shipped `settingsKeys.ts` shape.
 */
export const billingKeys = {
  all: ['billing'] as const,
  summary: () => [...billingKeys.all, 'summary'] as const,
  plans: () => [...billingKeys.all, 'plans'] as const,
} as const
