/**
 * useBillingErrorDialogStore — the global mounting seam's state for the latent
 * 409/402 hard-block dialogs (Story 9-1b, AC16 / D-9-1b-3).
 *
 * `PLAN_LIMIT_EXCEEDED` and `INSUFFICIENT_CREDITS` originate on mutations
 * app-wide, so the dialog can't live on a billing page. This store holds the
 * offending `ApiError`; `BillingErrorDialogHost` (mounted once at the app root)
 * renders the right dialog off it. 9.2 reuses this seam to wire staff-invite /
 * class-create / AI-grade without re-plumbing (9-1b wires enrolment only).
 *
 * UI-only ephemeral state (FW-5) — the `ApiError` is a transient view concern,
 * never server data. `initialState` is exported and a `reset()` action is
 * provided per the TEST-FE-3 reset pattern.
 */
import { create } from 'zustand'
import type { ApiError } from '@/lib/api-fetch'

export interface BillingErrorDialogState {
  /** The billing error currently surfaced, or null when no dialog is open. */
  error: ApiError | null
}

export interface BillingErrorDialogActions {
  show: (error: ApiError) => void
  dismiss: () => void
  reset: () => void
}

export const initialState: BillingErrorDialogState = {
  error: null,
}

export const useBillingErrorDialogStore = create<
  BillingErrorDialogState & BillingErrorDialogActions
>((set) => ({
  ...initialState,
  show: (error) => set({ error }),
  dismiss: () => set({ error: null }),
  reset: () => set(initialState),
}))
