/**
 * useBillingAddons — the AI-credit add-on packs available for the caller's tier
 * (Story 9-2b, AC7/AC9). `GET /api/billing/addons` returns
 * `{ addons: BillingAddonOffer[] }` with tier-resolved VND pricing + VAT breakout.
 *
 * A Free-tier center is not eligible (D25): the endpoint answers `403
 * ADDON_NOT_AVAILABLE`. That is **eligibility, not an error** — the surface must
 * show an upgrade prompt, not the error trilogy (AC9). So the queryFn catches that
 * one code and resolves to `{ addons: [], eligible: false }`; every other failure
 * rethrows into the normal error trilogy. Callers branch on `data.eligible`.
 *
 * `staleTime` is moderate (5m): the catalog is near-static (server-locked prices)
 * but tier eligibility can flip after an upgrade, so it should not be as long-lived
 * as the plan catalog (FW-3).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type BillingAddonOffer = components['schemas']['BillingAddonOffer']

export interface BillingAddons {
  addons: BillingAddonOffer[]
  /** False when the caller's tier (Free) cannot buy add-ons (403 ADDON_NOT_AVAILABLE). */
  eligible: boolean
}

const ADDONS_STALE_TIME_MS = 5 * 60 * 1000

/** useBillingAddons fetches `GET /api/billing/addons`, mapping the Free 403 to `eligible: false`. */
export function useBillingAddons(enabled = true) {
  return useQuery<BillingAddons, ApiError>({
    queryKey: billingKeys.addons(),
    queryFn: async () => {
      try {
        const data = await apiFetch<{ addons: BillingAddonOffer[] }>(
          '/api/billing/addons',
        )
        return { addons: data.addons, eligible: true }
      } catch (error) {
        if (error instanceof ApiError && error.code === 'ADDON_NOT_AVAILABLE') {
          return { addons: [], eligible: false }
        }
        throw error
      }
    },
    enabled,
    staleTime: ADDONS_STALE_TIME_MS,
  })
}
