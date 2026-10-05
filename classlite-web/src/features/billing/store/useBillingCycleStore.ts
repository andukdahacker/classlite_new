/**
 * useBillingCycleStore — the monthly/annual billing-cycle intent (Story 9-2b,
 * AC16 / FU-9-1B-TOGGLE-PERSIST). Lifted out of `PlanPickerPage`'s local
 * `useState(false)` so the selection survives navigation within the session (the
 * FR-61 conversion lever) — the upgrade modal reads the same intent.
 *
 * UI-only ephemeral state (FW-5) — never server data, never the Query cache.
 * `initialState` is exported and a `reset()` action is provided per TEST-FE-3.
 */
import { create } from 'zustand'

export interface BillingCycleState {
  /** True = annual billing selected; false = monthly. */
  annual: boolean
}

export interface BillingCycleActions {
  setAnnual: (annual: boolean) => void
  toggle: () => void
  reset: () => void
}

export const initialState: BillingCycleState = {
  annual: false,
}

export const useBillingCycleStore = create<
  BillingCycleState & BillingCycleActions
>((set) => ({
  ...initialState,
  setAnnual: (annual) => set({ annual }),
  toggle: () => set((state) => ({ annual: !state.annual })),
  reset: () => set(initialState),
}))
