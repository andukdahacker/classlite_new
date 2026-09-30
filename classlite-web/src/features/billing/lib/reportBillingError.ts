/**
 * reportBillingError — the global-seam entry point (Story 9-1b, D-9-1b-3).
 *
 * A mutation's `onError` calls this with the caught error. When the error is a
 * billing hard-block (409 `PLAN_LIMIT_EXCEEDED` / 402 `INSUFFICIENT_CREDITS`)
 * it opens the corresponding dialog via the shared store and returns `true`, so
 * the caller can suppress its own generic error toast. For every other error it
 * returns `false` and the caller handles it as before.
 *
 * Enforcement is dark-launched OFF (D19), so in 9-1b this fires only from
 * MSW-mocked responses in tests; 9.2 arms it in prod.
 */
import { ApiError } from '@/lib/api-fetch'
import { useBillingErrorDialogStore } from '../store/useBillingErrorDialogStore'

const BILLING_HARD_BLOCK_CODES = new Set([
  'PLAN_LIMIT_EXCEEDED',
  'INSUFFICIENT_CREDITS',
])

/**
 * reportBillingError surfaces a billing hard-block dialog for a billing error.
 * @returns true when the error was a billing hard-block and a dialog was shown.
 */
export function reportBillingError(error: unknown): boolean {
  if (error instanceof ApiError && BILLING_HARD_BLOCK_CODES.has(error.code)) {
    useBillingErrorDialogStore.getState().show(error)
    return true
  }
  return false
}
