/**
 * useCreateCheckout — start a Polar hosted-checkout session for an upgrade or an
 * add-on pack (Story 9-2b, AC2/AC8). `POST /api/billing/checkout` with a
 * `BillingCheckoutRequest` returns `{ checkoutUrl }`; on success the browser is
 * redirected to the Polar-hosted page (`window.location.assign`).
 *
 * The FE NEVER mutates plan/credit state here — the subscription/credit change is
 * confirmed webhook-side and surfaced on the next `GET /api/billing` poll (D2/D4).
 * `onError` runs `reportBillingError` first (the shared global-seam contract, even
 * though checkout's own error codes — 403 `ADDON_NOT_AVAILABLE` / 422
 * `VALIDATION_ERROR` — are handled inline by the caller, not the global dialog).
 *
 * `kind` is the generated enum `"upgrade" | "addon"` — NOT the legacy
 * `"plan_upgrade"` service alias (which is off-contract, AC2 pin).
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { reportBillingError } from '../lib/reportBillingError'
import { billingKeys } from './billingKeys'

export type BillingCheckoutRequest =
  components['schemas']['BillingCheckoutRequest']

interface CheckoutResult {
  checkoutUrl: string
}

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

/**
 * isSafeCheckoutUrl — only an absolute `https:` URL may be navigated to. Guards the
 * one navigation that leaves the SPA on the money path: an empty `""` would reload
 * the current page (a silent dead-end) and a `javascript:`/off-scheme value from a
 * misbehaving backend would be followed blindly. We trust the host (our API proxies
 * Polar) but validate the scheme as defence-in-depth.
 */
function isSafeCheckoutUrl(url: string): boolean {
  if (!url) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

/** useCreateCheckout posts a checkout request and redirects to the returned Polar URL. */
export function useCreateCheckout() {
  return useMutation<CheckoutResult, ApiError, BillingCheckoutRequest>({
    mutationKey: billingKeys.checkoutMutation(),
    mutationFn: async (body) => {
      const result = await apiFetch<CheckoutResult>('/api/billing/checkout', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      })
      // Validate here (not in onSuccess) so a missing/unsafe URL routes to the
      // mutation's error state — which the caller surfaces inline — instead of
      // a silent reload. See isSafeCheckoutUrl.
      if (!isSafeCheckoutUrl(result.checkoutUrl)) {
        throw new ApiError(502, 'CHECKOUT_URL_INVALID', 'invalid checkout url', null)
      }
      return result
    },
    onSuccess: (data) => {
      // Leave the SPA for the Polar-hosted checkout page. No local state change —
      // confirmation is webhook-driven and reconciled on return via GET /api/billing.
      window.location.assign(data.checkoutUrl)
    },
    onError: (error) => {
      // Defensive global-seam consistency (D-9-1b-3); returns false for checkout's
      // own 403/422 codes, which the caller surfaces inline (checkout.isError).
      reportBillingError(error)
    },
  })
}
