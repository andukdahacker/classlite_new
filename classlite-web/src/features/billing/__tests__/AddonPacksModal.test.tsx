// Story 9-2b — Task 5 (AC7/8/9/10/18). The add-on purchase surface: packs with VAT
// breakout, a Polar redirect on buy, the Free→upgrade-prompt branch (eligibility not
// a 402), the downgrade-to-Free warning gate, and the desktop-only mobile hint.
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
import { AddonPacksModal } from '../components/AddonPacksModal'

type BillingSummary = components['schemas']['BillingSummary']

function proSummary(pending: BillingSummary['pendingDowngrade'] = null): BillingSummary {
  return {
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
    pendingDowngrade: pending,
    grace: null,
  }
}

const PACK = { packId: 'credits_500', credits: 500, priceVnd: 399000, subtotalVnd: 362727, vatVnd: 36273 }

function wrap(ui: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
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

describe('AddonPacksModal', () => {
  test('renders packs with the explicit VAT breakout (AC7/AC13)', async () => {
    server.use(
      http.get('*/api/billing', () => HttpResponse.json({ data: proSummary(), meta: { requestId: 't' } })),
      http.get('*/api/billing/addons', () => HttpResponse.json({ data: { addons: [PACK] }, meta: { requestId: 't' } })),
    )
    render(wrap(<AddonPacksModal open onClose={() => {}} />))
    const card = await screen.findByTestId('addon-pack-credits_500')
    expect(card).toHaveTextContent(formatVnd(399000))
    expect(card).toHaveTextContent(i18n.t('billing.picker.vatSplit', { subtotal: formatVnd(362727), vat: formatVnd(36273) }))
    expect(card).toHaveTextContent(i18n.t('billing.addons.packCredits', { credits: 500 }))
  })

  test('buy posts kind:"addon" and redirects to the Polar checkoutUrl (AC8)', async () => {
    let captured: Record<string, unknown> | null = null
    server.use(
      http.get('*/api/billing', () => HttpResponse.json({ data: proSummary(), meta: { requestId: 't' } })),
      http.get('*/api/billing/addons', () => HttpResponse.json({ data: { addons: [PACK] }, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', async ({ request }) => {
        captured = (await request.json()) as Record<string, unknown>
        return HttpResponse.json({ data: { checkoutUrl: 'https://polar.sh/c/addon' }, meta: { requestId: 't' } })
      }),
    )
    render(wrap(<AddonPacksModal open onClose={() => {}} />))
    await userEvent.click(await screen.findByTestId('addon-pack-buy-credits_500'))
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('https://polar.sh/c/addon'))
    expect(captured).toEqual({ kind: 'addon', addonPackId: 'credits_500', plan: null, billingCycle: null })
  })

  test('Free tier (403 ADDON_NOT_AVAILABLE) shows the upgrade prompt, not packs or an error (AC9)', async () => {
    server.use(
      http.get('*/api/billing', () => HttpResponse.json({ data: { ...proSummary(), plan: 'free', isFree: true, creditsApplicable: false }, meta: { requestId: 't' } })),
      http.get('*/api/billing/addons', () => HttpResponse.json({ error: { code: 'ADDON_NOT_AVAILABLE', message: 'free', requestId: 't' } }, { status: 403 })),
    )
    render(wrap(<AddonPacksModal open onClose={() => {}} />))
    expect(await screen.findByTestId('addon-packs-free-prompt')).toBeInTheDocument()
    expect(screen.queryByTestId('addon-packs-error')).not.toBeInTheDocument()
    expect(screen.queryByTestId('addon-pack-credits_500')).not.toBeInTheDocument()
  })

  test('a scheduled downgrade-to-Free warns before purchase, then proceeds (AC10)', async () => {
    let bought = false
    server.use(
      http.get('*/api/billing', () => HttpResponse.json({ data: proSummary({ plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' }), meta: { requestId: 't' } })),
      http.get('*/api/billing/addons', () => HttpResponse.json({ data: { addons: [PACK] }, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', () => {
        bought = true
        return HttpResponse.json({ data: { checkoutUrl: 'https://polar.sh/c/addon' }, meta: { requestId: 't' } })
      }),
    )
    render(wrap(<AddonPacksModal open onClose={() => {}} />))
    await userEvent.click(await screen.findByTestId('addon-pack-buy-credits_500'))
    // The purchase is gated behind the warning — not fired yet.
    const warn = await screen.findByTestId('addon-downgrade-warn')
    expect(bought).toBe(false)
    await userEvent.click(within(warn).getByTestId('addon-downgrade-warn-proceed'))
    await waitFor(() => expect(bought).toBe(true))
  })

  // Code-review patch (2026-10-05): a failed add-on checkout POST must surface inline
  // (was silently swallowed). A checkout 403 points at the plans page (tier changed
  // between load and buy); any other failure gets the generic retry copy.
  test('surfaces an inline error when the add-on checkout POST fails', async () => {
    server.use(
      http.get('*/api/billing', () => HttpResponse.json({ data: proSummary(), meta: { requestId: 't' } })),
      http.get('*/api/billing/addons', () => HttpResponse.json({ data: { addons: [PACK] }, meta: { requestId: 't' } })),
      http.post('*/api/billing/checkout', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom', requestId: 't' } }, { status: 500 }),
      ),
    )
    render(wrap(<AddonPacksModal open onClose={() => {}} />))
    await userEvent.click(await screen.findByTestId('addon-pack-buy-credits_500'))
    expect(await screen.findByTestId('addon-packs-checkout-error')).toBeInTheDocument()
    expect(location.assign).not.toHaveBeenCalled()
  })

  test('mobile width shows the desktop hint, not the packs (AC18)', async () => {
    const original = window.matchMedia
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia
    try {
      render(wrap(<AddonPacksModal open onClose={() => {}} />))
      expect(await screen.findByTestId('addon-packs-mobile-hint')).toBeInTheDocument()
      expect(screen.queryByTestId('addon-packs-modal')).not.toBeInTheDocument()
    } finally {
      window.matchMedia = original
    }
  })
})
