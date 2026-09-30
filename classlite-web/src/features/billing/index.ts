/**
 * Billing feature public surface (Story 9-1b). Cross-feature consumers import
 * from this barrel only (TS-7) — e.g. `EnrolmentComposer` (people) reaches
 * `reportBillingError` and the app root mounts `BillingErrorDialogHost` here.
 */
export { PlanPickerPage } from './PlanPickerPage'
export { BillingDashboardPage } from './BillingDashboardPage'
export { BillingErrorDialogHost } from './components/BillingErrorDialogHost'
export { reportBillingError } from './lib/reportBillingError'
export { billingKeys } from './api/billingKeys'
export { useBillingSummary, type BillingSummary } from './api/useBillingSummary'
export { useBillingPlans, type PlanCatalogEntry } from './api/useBillingPlans'
