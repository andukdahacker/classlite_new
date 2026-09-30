// Story 9-1b — the global ApiError seam (D-9-1b-3) + C16 store-reset hygiene.
// `reportBillingError` routes only billing hard-blocks into the shared store;
// `BillingErrorDialogHost` renders the matching dialog off it. A non-billing
// error must NOT be captured (returns false → caller keeps its own handling).
import { render, screen, cleanup } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import { BillingErrorDialogHost } from '../components/BillingErrorDialogHost'
import { reportBillingError } from '../lib/reportBillingError'
import { useBillingErrorDialogStore } from '../store/useBillingErrorDialogStore'

function renderHost(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <BillingErrorDialogHost />
    </I18nextProvider>,
  )
}

afterEach(() => {
  cleanup()
  // C16 — the billing dialog store is a module singleton; reset it so a queued
  // error never bleeds into the next test.
  useBillingErrorDialogStore.getState().reset()
})

const planLimit409 = new ApiError(409, 'PLAN_LIMIT_EXCEEDED', 'msg', 'r', {
  limit: 'CLASSES',
  current: 1,
  max: 1,
  canManageBilling: true,
})
const credits402 = new ApiError(402, 'INSUFFICIENT_CREDITS', 'msg', 'r', {
  available: 3,
  required: 10,
})
const notEnrolled = new ApiError(409, 'ALREADY_ENROLLED', 'msg', 'r', null)

describe('global ApiError seam (D-9-1b-3)', () => {
  test('a 409 PLAN_LIMIT_EXCEEDED is captured and rendered by the host', () => {
    expect(reportBillingError(planLimit409)).toBe(true)
    renderHost()
    expect(screen.getByText(i18n.t('billing.error.planLimitExceeded'))).toBeInTheDocument()
  })

  test('a 402 INSUFFICIENT_CREDITS is captured and rendered by the host', () => {
    expect(reportBillingError(credits402)).toBe(true)
    renderHost()
    expect(screen.getByText(i18n.t('billing.error.insufficientCredits'))).toBeInTheDocument()
  })

  test('a non-billing error is NOT captured and the host renders nothing', () => {
    expect(reportBillingError(notEnrolled)).toBe(false)
    renderHost()
    expect(screen.queryByTestId('plan-limit-exceeded-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('insufficient-credits-dialog')).not.toBeInTheDocument()
  })
})
