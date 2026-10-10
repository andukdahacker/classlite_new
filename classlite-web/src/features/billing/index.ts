/**
 * Billing feature public surface (Story 9-1b; extended 9-2b). Cross-feature
 * consumers import from this barrel only (TS-7) — e.g. `EnrolmentComposer` (people)
 * reaches `reportBillingError` and the app root mounts `BillingErrorDialogHost`.
 */
export { PlanPickerPage } from './PlanPickerPage'
export { BillingDashboardPage } from './BillingDashboardPage'
export { BillingErrorDialogHost } from './components/BillingErrorDialogHost'
export { reportBillingError } from './lib/reportBillingError'
export { planDisplayName } from './lib/planDisplay'
export { billingKeys } from './api/billingKeys'
export { useBillingSummary, type BillingSummary } from './api/useBillingSummary'
export { useBillingPlans, type PlanCatalogEntry } from './api/useBillingPlans'
// Story 9-2b additions.
export { useProrationPreview, type BillingProrationPreview } from './api/useProrationPreview'
export { useBillingAddons, type BillingAddonOffer, type BillingAddons } from './api/useBillingAddons'
export { useCreateCheckout, type BillingCheckoutRequest } from './api/useCreateCheckout'
export {
  useScheduleDowngrade,
  useCancelDowngrade,
  type BillingDowngradeRequest,
} from './api/useScheduleDowngrade'
export { UpgradeModal } from './components/UpgradeModal'
export { DowngradeConfirmModal } from './components/DowngradeConfirmModal'
export { PendingDowngradeCard } from './components/PendingDowngradeCard'
export { AddonPacksModal } from './components/AddonPacksModal'
export { useBillingCycleStore } from './store/useBillingCycleStore'
// Story 9.3 — grace strip (s73) + invoice history (s70).
export { BillingGraceBanner } from './components/BillingGraceBanner'
export { InvoiceHistoryPage } from './components/InvoiceHistoryPage'
export { useGrace, type BillingGrace } from './api/useGrace'
export { useInvoices, type BillingInvoice } from './api/useInvoices'
export { useEmailInvoices } from './api/useEmailInvoices'
export {
  normalizeSummaryPending,
  normalizeEndpointPending,
  type PendingDowngrade,
} from './lib/pendingDowngrade'
