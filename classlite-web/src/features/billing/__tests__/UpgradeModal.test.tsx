// Story 9-2b — Task 3 (AC1/AC2/AC3/AC18). The s71 upgrade modal.
//
// P1 MONEY TEST (ATDD checklist AC1/AC2 proration-verbatim): the charge block renders
// subtotal/credit/VAT/charged-today EXACTLY as the proration endpoint returns them
// (formatVnd of the server integer VND) — the FE never recomputes. Confirm posts
// kind:"upgrade" (NOT "plan_upgrade") and redirects to the Polar checkoutUrl.
import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { formatVnd } from '../lib/formatVnd'
import { UpgradeModal } from '../components/UpgradeModal'

type BillingSummary = components['schemas']['BillingSummary']
type BillingProrationPreview = components['schemas']['BillingProrationPreview']

const SUMMARY: BillingSummary = {
  plan: 'pro',
  billingCycle: 'monthly',
  status: 'active',
  isFree: false,
  creditsApplicable: true,
  currentPeriodStart: '2026-09-01T00:00:00+07:00',
  currentPeriodEnd: '2026-10-01T00:00:00+07:00',
  limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
  usage: {
    teacherSeats: { current: 3, max: 10, approaching: false },
    classes: { current: 4, max: null, approaching: false },
    aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' },
    storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false },
  },
  nextInvoice: null,
  paymentMethod: null,
  pendingDowngrade: null,
}

const STUDIO_ENTRY = {
  plan: 'studio' as const,
  limits: { teachers: null, classes: null, studentsPerClass: 60, aiCreditsPerMonth: 2000, storageBytes: 53687091200 },
  priceMonthlyVnd: 999000,
  priceAnnualVnd: 9990000,
  vat: { monthlySubtotal: 908182, monthlyVat: 90818, annualSubtotal: 9081818, annualVat: 908182 },
}

// Deliberately distinct values so a verbatim render is provable (no field equals another).
const PREVIEW: BillingProrationPreview = {
  targetPlan: 'studio',
  targetBillingCycle: 'monthly',
  subtotalVnd: 545454,
  vatVnd: 54546,
  totalVnd: 600000,
  creditAppliedVnd: 123000,
  chargedTodayVnd: 477000,
}

function wrap(ui: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

function seedReadHandlers(): void {
  server.use(
    http.get('*/api/billing', () => HttpResponse.json({ data: SUMMARY, meta: { requestId: 't' } })),
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: [STUDIO_ENTRY] }, meta: { requestId: 't' } })),
  )
}

let location: StubbedLocation
beforeEach(() => {
  location = stubLocation()
})
afterEach(() => {
  cleanup()
  location.restore()
})

describe('UpgradeModal (s71)', () => {
  test('renders the proration charge block VERBATIM from the preview (AC1/AC2 P1)', async () => {
    seedReadHandlers()
    server.use(
      http.get('*/api/billing/proration-preview', () => HttpResponse.json({ data: PREVIEW, meta: { requestId: 't' } })),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))

    await screen.findByTestId('upgrade-modal-charge')
    expect(screen.getByTestId('upgrade-charge-subtotal')).toHaveTextContent(formatVnd(545454))
    expect(screen.getByTestId('upgrade-charge-credit')).toHaveTextContent(`−${formatVnd(123000)}`)
    expect(screen.getByTestId('upgrade-charge-vat')).toHaveTextContent(`+${formatVnd(54546)}`)
    expect(screen.getByTestId('upgrade-charge-today')).toHaveTextContent(formatVnd(477000))
    // The confirm CTA shows the charged-today amount verbatim.
    expect(screen.getByTestId('upgrade-modal-confirm')).toHaveTextContent(formatVnd(477000))
  })

  test('confirm posts kind:"upgrade" and redirects to the Polar checkoutUrl (AC2)', async () => {
    seedReadHandlers()
    let captured: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/billing/proration-preview', () => HttpResponse.json({ data: PREVIEW, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ data: { checkoutUrl: 'https://polar.sh/c/xyz' }, meta: { requestId: 't' } })
      }),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
    await screen.findByTestId('upgrade-modal-charge')
    await userEvent.click(screen.getByTestId('upgrade-modal-confirm'))

    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('https://polar.sh/c/xyz'))
    expect(captured).toEqual({ kind: 'upgrade', plan: 'studio', billingCycle: 'monthly', addonPackId: null })
  })

  test('shows an inline retry on a proration error, then recovers (UX-1)', async () => {
    seedReadHandlers()
    let calls = 0
    server.use(
      http.get('*/api/billing/proration-preview', () => {
        calls += 1
        if (calls === 1) {
          return HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom', requestId: 't' } }, { status: 500 })
        }
        return HttpResponse.json({ data: PREVIEW, meta: { requestId: 't' } })
      }),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
    const err = await screen.findByTestId('upgrade-modal-error')
    await userEvent.click(within(err).getByRole('button'))
    await screen.findByTestId('upgrade-modal-charge')
  })

  // Code-review patch (2026-10-05): a failed checkout POST must surface inline — the
  // bug was a silently-swallowed failure on the money path (button re-enables, no feedback).
  test('surfaces an inline error when the checkout POST fails (no silent swallow)', async () => {
    seedReadHandlers()
    server.use(
      http.get('*/api/billing/proration-preview', () => HttpResponse.json({ data: PREVIEW, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom', requestId: 't' } }, { status: 500 }),
      ),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
    await screen.findByTestId('upgrade-modal-charge')
    await userEvent.click(screen.getByTestId('upgrade-modal-confirm'))

    expect(await screen.findByTestId('upgrade-modal-checkout-error')).toBeInTheDocument()
    expect(location.assign).not.toHaveBeenCalled()
  })

  // Code-review patch (2026-10-05): an empty/non-https checkoutUrl must become an error,
  // not a silent reload of the current page.
  test('treats an empty checkoutUrl as an error and does not navigate', async () => {
    seedReadHandlers()
    server.use(
      http.get('*/api/billing/proration-preview', () => HttpResponse.json({ data: PREVIEW, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', () =>
        HttpResponse.json({ data: { checkoutUrl: '' }, meta: { requestId: 't' } }),
      ),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
    await screen.findByTestId('upgrade-modal-charge')
    await userEvent.click(screen.getByTestId('upgrade-modal-confirm'))

    expect(await screen.findByTestId('upgrade-modal-checkout-error')).toBeInTheDocument()
    expect(location.assign).not.toHaveBeenCalled()
  })

  // Code-review patch (2026-10-05): a zero credit/VAT must not render a bare "−0 ₫" / "+0 ₫".
  test('omits the sign when credit or VAT is zero', async () => {
    seedReadHandlers()
    server.use(
      http.get('*/api/billing/proration-preview', () =>
        HttpResponse.json({
          data: { ...PREVIEW, creditAppliedVnd: 0, vatVnd: 0 },
          meta: { requestId: 't' },
        }),
      ),
    )
    render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
    await screen.findByTestId('upgrade-modal-charge')
    expect(screen.getByTestId('upgrade-charge-credit').textContent).not.toContain('−')
    expect(screen.getByTestId('upgrade-charge-vat').textContent).not.toContain('+')
  })

  test('mobile width shows the desktop hint, not the modal (AC18)', async () => {
    seedReadHandlers()
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: false, // min-width no longer matches → mobile
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="studio" billingCycle="monthly" />))
      expect(await screen.findByTestId('upgrade-modal-mobile-hint')).toBeInTheDocument()
      expect(screen.queryByTestId('upgrade-modal-charge')).not.toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})
