/**
 * BillingErrorDialogHost — the single global mount for the latent 409/402
 * hard-block dialogs (Story 9-1b, D-9-1b-3). Rendered once at the app root; it
 * reads the shared `useBillingErrorDialogStore` and shows the dialog that
 * matches the error `code`. Any mutation, anywhere, surfaces its billing block
 * through `reportBillingError` without owning dialog markup.
 */
import type { ReactElement } from 'react'
import { useBillingErrorDialogStore } from '../store/useBillingErrorDialogStore'
import { PlanLimitExceededDialog } from './PlanLimitExceededDialog'
import { InsufficientCreditsDialog } from './InsufficientCreditsDialog'

export function BillingErrorDialogHost(): ReactElement | null {
  const error = useBillingErrorDialogStore((state) => state.error)
  const dismiss = useBillingErrorDialogStore((state) => state.dismiss)

  if (!error) return null

  if (error.code === 'INSUFFICIENT_CREDITS') {
    return <InsufficientCreditsDialog open error={error} onClose={dismiss} />
  }
  return <PlanLimitExceededDialog open error={error} onClose={dismiss} />
}
