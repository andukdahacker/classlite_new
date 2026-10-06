// Story 9-1b — the global ApiError seam (D-9-1b-3) + C16 store-reset hygiene.
// `reportBillingError` routes only billing hard-blocks into the shared store;
// `BillingErrorDialogHost` renders the matching dialog off it. A non-billing
// error must NOT be captured (returns false → caller keeps its own handling).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { BillingErrorDialogHost } from '../components/BillingErrorDialogHost'
import { reportBillingError } from '../lib/reportBillingError'
import { useBillingErrorDialogStore } from '../store/useBillingErrorDialogStore'

// 9-2b: PlanLimitExceededDialog's owner branch reads the billing summary (to offer the
// upgrade modal), so the host now needs a QueryClientProvider + billing summary stub.
beforeEach(() => {
  server.use(
    http.get('*/api/billing', () => HttpResponse.json({ data: { plan: 'pro', billingCycle: 'monthly', status: 'active', isFree: false, creditsApplicable: true, currentPeriodStart: '2026-09-01T00:00:00+07:00', currentPeriodEnd: '2026-10-01T00:00:00+07:00', limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 }, usage: { teacherSeats: { current: 3, max: 10, approaching: false }, classes: { current: 4, max: null, approaching: false }, aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' }, storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false } }, nextInvoice: null, paymentMethod: null, pendingDowngrade: null, grace: null }, meta: { requestId: 't' } })),
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: [] }, meta: { requestId: 't' } })),
  )
})

function renderHost(): void {
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <BillingErrorDialogHost />
        </MemoryRouter>
      </QueryClientProvider>
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
