// ATDD RED-PHASE — Story 9-1b, Task 3 (billing dashboard s69). MANDATORY-ATDD slice
// FR2 (Free user shown a FALSE credit/entitlement state — Murat re-score ≥6). Matrix
// C3/C4/C5/C9/C10/C15 + AC7/AC8/AC9/AC10.
//
// RED signals (compile-fail via tsc -b):
//   1. `@/features/billing/BillingDashboardPage` does not exist yet (TS2307).
//   2. `@/features/billing/api/useBillingSummary` does not exist yet (TS2307).
// MSW fixtures are codegen-typed against components['schemas']['BillingSummary'].
//
// GREEN-PHASE SEAMS:
//   - features/billing/BillingDashboardPage.tsx (current-plan card + 4 meters)
//   - D24/AC9: isFree → AI-credits meter REPLACED by a "See plans" CTA (never 0/0);
//     dashboard leads with "See plans" (D-9-1b-1: NOT "Upgrade").
//   - AC8/H: PlanUsageMeter renders server `approaching` verbatim; max===null →
//     "Unlimited" AND suppresses .warn.
//   - AC10/TS-6: resetAt via the i18n date formatter (dd/MM/yyyy vi), rendered as-is.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
// RED: this module does not exist yet.
import { BillingDashboardPage } from '@/features/billing/BillingDashboardPage'

type BillingSummary = components['schemas']['BillingSummary']

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

const FREE: BillingSummary = {
  plan: 'free',
  billingCycle: 'monthly',
  status: 'active',
  isFree: true,
  creditsApplicable: false,
  currentPeriodStart: '2026-09-01T00:00:00+07:00',
  currentPeriodEnd: null,
  limits: { teachers: 1, classes: 1, studentsPerClass: 5, aiCreditsPerMonth: 0, storageBytes: 524288000 },
  usage: {
    teacherSeats: { current: 1, max: 1, approaching: true },
    classes: { current: 1, max: 1, approaching: true },
    aiCredits: { monthlyAllocation: 0, monthlyUsed: 0, addonRemaining: 0, available: 0, resetAt: '2026-10-01T00:00:00+07:00' },
    storage: { usedBytes: 100, limitBytes: 524288000, percentUsed: 0, approaching: false },
  },
  nextInvoice: null,
  paymentMethod: null,
  pendingDowngrade: null,
}

const STUDIO: BillingSummary = {
  plan: 'studio',
  billingCycle: 'annual',
  status: 'active',
  isFree: false,
  creditsApplicable: true,
  currentPeriodStart: '2026-09-01T00:00:00+07:00',
  currentPeriodEnd: '2027-09-01T00:00:00+07:00',
  limits: { teachers: null, classes: null, studentsPerClass: 60, aiCreditsPerMonth: 2000, storageBytes: 53687091200 },
  usage: {
    // Unlimited teachers: max null. approaching:true here is a deliberate server-slip
    // to prove the FE SUPPRESSES .warn on an unlimited meter (AC8/H defensive guard).
    teacherSeats: { current: 42, max: null, approaching: true },
    classes: { current: 12, max: null, approaching: false },
    aiCredits: { monthlyAllocation: 2000, monthlyUsed: 1900, addonRemaining: 0, available: 100, resetAt: '2026-10-01T00:00:00+07:00' },
    storage: { usedBytes: 48000000000, limitBytes: 53687091200, percentUsed: 89, approaching: true },
  },
  nextInvoice: null,
  paymentMethod: null,
  pendingDowngrade: null,
}

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u-owner', email: 'owner@example.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role: 'owner' as Role,
  })
}

function renderDashboard(): void {
  seedOwner()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/settings/billing']}>
          <BillingDashboardPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

function useSummary(s: BillingSummary): void {
  server.use(http.get('*/api/billing', () => HttpResponse.json({ data: s, meta: { requestId: 't' } })))
}

afterEach(() => {
  queryClient.clear()
})

describe('BillingDashboardPage — Free-tier false-entitlement (FR2 / C3-C5 / D24)', () => {
  test('isFree=true → "See plans" CTA present AND the AI-credits meter is ABSENT from DOM', async () => {
    useSummary(FREE)
    renderDashboard()
    // Positive: the honest CTA (D-9-1b-1: "See plans", not "Upgrade").
    expect(await screen.findByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).toBeInTheDocument()
    // Negative (the real bug): NO 0/0 credit meter for a Free center.
    expect(screen.queryByTestId('plan-usage-meter-aiCredits')).not.toBeInTheDocument()
    // Negative: never render an "Upgrade" verb (dead action pre-9.2).
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  test('isFree=false → AI-credits meter PRESENT and the Free lead-CTA ABSENT', async () => {
    useSummary(STUDIO)
    renderDashboard()
    expect(await screen.findByTestId('plan-usage-meter-aiCredits')).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('billing.dashboard.aiNotIncluded'))).not.toBeInTheDocument()
  })
})

describe('BillingDashboardPage — meters (C9/C10/AC8/AC10)', () => {
  test('max===null renders "Unlimited", no numeric ratio, and .warn SUPPRESSED despite approaching=true', async () => {
    useSummary(STUDIO)
    renderDashboard()
    const seats = await screen.findByTestId('plan-usage-meter-teacherSeats')
    expect(seats).toHaveTextContent(i18n.t('billing.meter.unlimited'))
    expect(seats).not.toHaveTextContent('/') // no "42 of null" ratio
    expect(seats).not.toHaveAttribute('data-warn', 'true') // unlimited can't be "approaching"
  })

  test('storage meter with approaching=true renders the amber .warn state', async () => {
    useSummary(STUDIO)
    renderDashboard()
    const storage = await screen.findByTestId('plan-usage-meter-storage')
    expect(storage).toHaveAttribute('data-warn', 'true')
  })

  test('paid credit meter shows available and a locale-formatted resetAt (never new Date())', async () => {
    useSummary(STUDIO)
    renderDashboard()
    const credits = await screen.findByTestId('plan-usage-meter-aiCredits')
    expect(credits).toHaveTextContent('100') // available
    // resetAt is VN-local midnight; rendered via the i18n formatter, not toLocaleString.
    expect(credits).toHaveTextContent(i18n.t('billing.meter.resetAt', { val: STUDIO.usage.aiCredits.resetAt }))
  })
})

describe('BillingDashboardPage — three-state trilogy (C15/UX-1)', () => {
  test('renders a skeleton while the summary query is loading', async () => {
    useSummary(FREE)
    renderDashboard()
    expect(screen.getByTestId('billing-dashboard-skeleton')).toBeInTheDocument()
  })

  test('renders an error alert on network failure', async () => {
    server.use(http.get('*/api/billing', () => HttpResponse.error()))
    renderDashboard()
    expect(await screen.findByRole('alert')).toBeInTheDocument()
  })
})

// Story 9-2b — the D-DASH cards + upgrade/add-on entry points (AC6/11/12).
const PRO_BASE: BillingSummary = {
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

describe('BillingDashboardPage — 9-2b next-invoice card (AC11)', () => {
  test('renders the next-invoice card when non-null', async () => {
    useSummary({ ...PRO_BASE, nextInvoice: { amountVnd: 399000, dueDate: '2026-10-01T00:00:00+07:00' } })
    renderDashboard()
    const card = await screen.findByTestId('next-invoice-card')
    expect(within(card).getByText(/399\.000/)).toBeInTheDocument()
  })

  test('omits the card (no empty shell) when nextInvoice is null', async () => {
    useSummary(PRO_BASE)
    renderDashboard()
    await screen.findByTestId('billing-dashboard')
    expect(screen.queryByTestId('next-invoice-card')).not.toBeInTheDocument()
  })
})

describe('BillingDashboardPage — 9-2b payment-method card (AC12)', () => {
  test('renders the real brand + last4 when present', async () => {
    useSummary({ ...PRO_BASE, paymentMethod: { brand: 'visa', last4: '4242' } })
    renderDashboard()
    const card = await screen.findByTestId('payment-method-card')
    expect(card).toHaveTextContent('4242')
    expect(card).not.toHaveTextContent('null')
  })

  test('degrades to "Managed by Polar" when paymentMethod is null (never •••• null)', async () => {
    useSummary(PRO_BASE)
    renderDashboard()
    const card = await screen.findByTestId('payment-method-card')
    expect(card).toHaveTextContent(i18n.t('billing.paymentMethod.managed'))
    expect(card).not.toHaveTextContent('null')
  })

  test('omits the payment-method card entirely for a Free center', async () => {
    useSummary(FREE)
    renderDashboard()
    await screen.findByTestId('billing-dashboard')
    expect(screen.queryByTestId('payment-method-card')).not.toBeInTheDocument()
  })
})

describe('BillingDashboardPage — 9-2b pending-downgrade card (AC6)', () => {
  test('shows the scheduled downgrade and cancels it via the endpoint', async () => {
    let cancelled = false
    server.use(
      http.get('*/api/billing', () =>
        HttpResponse.json({ data: { ...PRO_BASE, pendingDowngrade: { plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' } }, meta: { requestId: 't' } }),
      ),
      http.post('*/api/billing/downgrade/cancel', () => {
        cancelled = true
        return HttpResponse.json({ data: { pendingPlan: '', pendingBillingCycle: '', effectiveAt: '' }, meta: { requestId: 't' } })
      }),
    )
    renderDashboard()
    const card = await screen.findByTestId('pending-downgrade-card')
    expect(card).toHaveTextContent(i18n.t('billing.pending.scheduled', { tier: 'Free', date: '2026-10-01T00:00:00+07:00' }))
    await userEvent.click(within(card).getByTestId('pending-downgrade-cancel'))
    await waitFor(() => expect(cancelled).toBe(true))
  })

  // Code-review patch (2026-10-05): a failed cancel must surface inline — the optimistic
  // rollback otherwise makes the card silently reappear (the click looks like a no-op).
  test('shows an inline error when the cancel request fails', async () => {
    server.use(
      http.get('*/api/billing', () =>
        HttpResponse.json({ data: { ...PRO_BASE, pendingDowngrade: { plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' } }, meta: { requestId: 't' } }),
      ),
      http.post('*/api/billing/downgrade/cancel', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom', requestId: 't' } }, { status: 500 }),
      ),
    )
    renderDashboard()
    const card = await screen.findByTestId('pending-downgrade-card')
    await userEvent.click(within(card).getByTestId('pending-downgrade-cancel'))
    expect(await screen.findByTestId('pending-downgrade-cancel-error')).toBeInTheDocument()
  })
})

describe('BillingDashboardPage — 9-2b return-from-checkout reconcile (AC3)', () => {
  test('?checkout=success invalidates the summary and strips the param', async () => {
    let calls = 0
    server.use(
      http.get('*/api/billing', () => {
        calls += 1
        return HttpResponse.json({ data: PRO_BASE, meta: { requestId: 't' } })
      }),
    )
    window.history.replaceState(null, '', '/settings/billing?checkout=success')
    try {
      renderDashboard()
      await screen.findByTestId('billing-dashboard')
      // The param is stripped so a reload/back doesn't re-trigger the bridge (the
      // deterministic proof the AC3 return handler ran).
      await waitFor(() => expect(window.location.search).not.toContain('checkout'))
      // The summary was fetched (and the invalidate kept it fresh) — not zero.
      expect(calls).toBeGreaterThanOrEqual(1)
    } finally {
      window.history.replaceState(null, '', '/')
    }
  })

  test('no reconcile refetch when the param is absent', async () => {
    let calls = 0
    server.use(
      http.get('*/api/billing', () => {
        calls += 1
        return HttpResponse.json({ data: PRO_BASE, meta: { requestId: 't' } })
      }),
    )
    renderDashboard()
    await screen.findByTestId('billing-dashboard')
    expect(screen.queryByTestId('billing-reconcile-banner')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toBe(1)
  })
})

describe('BillingDashboardPage — 9-2b upgrade + add-on entry points (AC2/AC7)', () => {
  test('a non-Studio paid center shows an "Upgrade" CTA that opens the s71 modal', async () => {
    useSummary(PRO_BASE)
    server.use(
      http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: [{ plan: 'studio', limits: { teachers: null, classes: null, studentsPerClass: 60, aiCreditsPerMonth: 2000, storageBytes: 53687091200 }, priceMonthlyVnd: 999000, priceAnnualVnd: 9990000, vat: { monthlySubtotal: 908182, monthlyVat: 90818, annualSubtotal: 9081818, annualVat: 908182 } }] }, meta: { requestId: 't' } })),
      http.get('*/api/billing/proration-preview', () => HttpResponse.json({ data: { targetPlan: 'studio', targetBillingCycle: 'monthly', subtotalVnd: 545454, vatVnd: 54546, totalVnd: 600000, creditAppliedVnd: 0, chargedTodayVnd: 600000 }, meta: { requestId: 't' } })),
    )
    renderDashboard()
    await userEvent.click(await screen.findByTestId('billing-dashboard-upgrade'))
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument()
  })

  test('the AI-credits meter has a "Buy more credits" CTA that opens the add-on modal', async () => {
    useSummary(PRO_BASE)
    server.use(
      http.get('*/api/billing/addons', () => HttpResponse.json({ data: { addons: [{ packId: 'credits_100', credits: 100, priceVnd: 99000, subtotalVnd: 90000, vatVnd: 9000 }] }, meta: { requestId: 't' } })),
    )
    renderDashboard()
    await userEvent.click(await screen.findByTestId('billing-buy-credits'))
    expect(await screen.findByTestId('addon-packs-modal')).toBeInTheDocument()
  })
})
