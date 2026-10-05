// ATDD RED-PHASE — Story 9-1b, Task 2 (plan picker s68). MANDATORY-ATDD slice FR1
// (wrong price / VAT display — Murat re-score ≥6). Matrix C1/C2 + AC3/AC4/AC5.
//
// RED signals (compile-fail via tsc -b, project FE red convention):
//   1. `@/features/billing/PlanPickerPage` does not exist yet (TS2307).
//   2. `@/features/billing/lib/formatVnd` does not exist yet (TS2307).
//   3. `@/features/billing/api/useBillingPlans` / `useBillingSummary` do not exist yet.
// The generated billing TYPES already ship in client.ts (PROVISIONAL), so the MSW
// fixtures below are codegen-typed (Murat: drift → tsc -b failure, not silent runtime
// fall-through). Everything else is a real assertion designed to fail before green.
//
// GREEN-PHASE SEAMS (what dev builds to turn this green):
//   - features/billing/PlanPickerPage.tsx (renders 3 PlanCards from GET /api/billing/plans)
//   - features/billing/api/useBillingPlans.ts (unwraps EnvelopePlanCatalog → {plans:[]})
//   - features/billing/api/useBillingSummary.ts (GET /api/billing → BillingSummary)
//   - features/billing/lib/formatVnd.ts (integer VND + '.' thousands + '₫/tháng|/năm')
//   - billing.* i18n keys in en.json + vi.json (lockstep)
//   - D-9-1b-1: non-current CTAs read "Talk to us about {tier}" and are mailto: links
//     (NO "Upgrade" verb — purchase is 9.2).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { PlanPickerPage } from '@/features/billing/PlanPickerPage'
import { useBillingCycleStore } from '@/features/billing/store/useBillingCycleStore'

type PlanCatalogEntry = components['schemas']['PlanCatalogEntry']
type BillingSummary = components['schemas']['BillingSummary']

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

// Codegen-typed catalog fixture — the exact locked values from internal/plan/plan.go.
// VAT is 10%-inclusive round-half-up: subtotal = round(price/1.1); vat = price - subtotal.
const PLANS: PlanCatalogEntry[] = [
  {
    plan: 'free',
    limits: { teachers: 1, classes: 1, studentsPerClass: 5, aiCreditsPerMonth: 0, storageBytes: 524288000 },
    priceMonthlyVnd: 0,
    priceAnnualVnd: 0,
    vat: { monthlySubtotal: 0, monthlyVat: 0, annualSubtotal: 0, annualVat: 0 },
  },
  {
    plan: 'pro',
    limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
    priceMonthlyVnd: 399000,
    priceAnnualVnd: 3990000,
    // 399000/1.1 = 362727.27 → round 362727; vat 36273. 3990000/1.1 = 3627272.7 → 3627273; vat 362727.
    vat: { monthlySubtotal: 362727, monthlyVat: 36273, annualSubtotal: 3627273, annualVat: 362727 },
  },
  {
    plan: 'studio',
    limits: { teachers: null, classes: null, studentsPerClass: 60, aiCreditsPerMonth: 2000, storageBytes: 53687091200 },
    priceMonthlyVnd: 999000,
    priceAnnualVnd: 9990000,
    vat: { monthlySubtotal: 908182, monthlyVat: 90818, annualSubtotal: 9081818, annualVat: 908182 },
  },
]

function summary(overrides: Partial<BillingSummary> = {}): BillingSummary {
  return {
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
      storage: { usedBytes: 0, limitBytes: 524288000, percentUsed: 0, approaching: false },
    },
    nextInvoice: null,
    paymentMethod: null,
    pendingDowngrade: null,
    ...overrides,
  }
}

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u-owner', email: 'owner@example.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role: 'owner' as Role,
  })
}

function renderPicker(): void {
  seedOwner()
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={['/settings/billing/plans']}>
          <PlanPickerPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

beforeEach(() => {
  server.use(
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: PLANS }, meta: { requestId: 't' } })),
    http.get('*/api/billing', () => HttpResponse.json({ data: summary(), meta: { requestId: 't' } })),
  )
})
afterEach(() => {
  queryClient.clear()
  // The annual toggle now persists in a module-singleton Zustand store (AC16) —
  // reset between tests so a flipped cycle does not leak forward (TEST-FE-3).
  useBillingCycleStore.getState().reset()
})

describe('PlanPickerPage — FR1 price/VAT display (C1/C2)', () => {
  test('renders the three tiers with locked monthly VND prices, thousands-separated', async () => {
    renderPicker()
    // Pro 399.000, Studio 999.000, Free 0 — exact locked figures with '.' separators.
    expect(await screen.findByText(/399\.000/)).toBeInTheDocument()
    expect(screen.getByText(/999\.000/)).toBeInTheDocument()
  })

  test('annual toggle shows annual figures (3.990.000 / 9.990.000) + savings callout', async () => {
    renderPicker()
    const toggle = await screen.findByRole('switch', { name: i18n.t('billing.picker.annualToggle') })
    toggle.click()
    expect(await screen.findByText(/3\.990\.000/)).toBeInTheDocument()
    expect(screen.getByText(/9\.990\.000/)).toBeInTheDocument()
    // "~2 months free" savings callout present on annual.
    expect(screen.getByText(i18n.t('billing.picker.annualSavings'))).toBeInTheDocument()
  })

  test('displays the server VAT split verbatim (never re-derived client-side) — Pro monthly', async () => {
    renderPicker()
    const proCard = await screen.findByTestId('plan-card-pro')
    // subtotal 362.727 + VAT 36.273 = 399.000; assert the server-provided split renders.
    expect(within(proCard).getByText(/362\.727/)).toBeInTheDocument()
    expect(within(proCard).getByText(/36\.273/)).toBeInTheDocument()
  })

  test('VAT-inclusive caption present on each priced tier', async () => {
    renderPicker()
    expect(await screen.findAllByText(i18n.t('billing.vatCaption'))).not.toHaveLength(0)
  })
})

describe('PlanPickerPage — current plan + real upgrade/downgrade CTAs (9-2b AC1/AC4)', () => {
  test('the caller current plan (free) is flagged and its CTA is neutralized', async () => {
    renderPicker()
    const freeCard = await screen.findByTestId('plan-card-free')
    expect(within(freeCard).getByText(i18n.t('billing.picker.currentPlan'))).toBeInTheDocument()
    // Current tier has neither an upgrade nor a downgrade CTA.
    expect(within(freeCard).queryByTestId('plan-card-upgrade-free')).not.toBeInTheDocument()
    expect(within(freeCard).queryByTestId('plan-card-downgrade-free')).not.toBeInTheDocument()
  })

  test('higher tiers show "Upgrade to {tier}" and open the s71 upgrade modal (AC1/AC2)', async () => {
    renderPicker() // current = free → pro & studio are upgrades
    const proCard = await screen.findByTestId('plan-card-pro')
    const upgrade = within(proCard).getByTestId('plan-card-upgrade-pro')
    expect(upgrade).toHaveTextContent(i18n.t('billing.action.upgradeTo', { tier: 'Pro' }))
    // Proration preview for the opened modal.
    server.use(
      http.get('*/api/billing/proration-preview', () =>
        HttpResponse.json(
          { data: { targetPlan: 'pro', targetBillingCycle: 'monthly', subtotalVnd: 362727, vatVnd: 36273, totalVnd: 399000, creditAppliedVnd: 0, chargedTodayVnd: 399000 }, meta: { requestId: 't' } },
        ),
      ),
    )
    upgrade.click()
    expect(await screen.findByTestId('upgrade-modal')).toBeInTheDocument()
  })

  test('lower tiers show "Downgrade to {tier}" and open the downgrade-confirm modal (AC4)', async () => {
    seedOwner()
    server.use(
      http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: PLANS }, meta: { requestId: 't' } })),
      http.get('*/api/billing', () => HttpResponse.json({ data: summary({ plan: 'studio', isFree: false, creditsApplicable: true, currentPeriodEnd: '2026-10-01T00:00:00+07:00' }), meta: { requestId: 't' } })),
    )
    render(
      <I18nextProvider i18n={i18n}>
        <QueryClientProvider client={createTestQueryClient()}>
          <MemoryRouter initialEntries={['/settings/billing/plans']}>
            <PlanPickerPage />
          </MemoryRouter>
        </QueryClientProvider>
      </I18nextProvider>,
    )
    const proCard = await screen.findByTestId('plan-card-pro')
    const downgrade = within(proCard).getByTestId('plan-card-downgrade-pro')
    expect(downgrade).toHaveTextContent(i18n.t('billing.action.downgradeTo', { tier: 'Pro' }))
    downgrade.click()
    expect(await screen.findByTestId('downgrade-confirm-modal')).toBeInTheDocument()
  })
})

describe('PlanPickerPage — annual toggle persists across navigation (AC16 / FU-9-1B-TOGGLE-PERSIST)', () => {
  test('flipping to annual survives an unmount + remount (session persistence)', async () => {
    seedOwner()
    function renderOnce() {
      return render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={createTestQueryClient()}>
            <MemoryRouter initialEntries={['/settings/billing/plans']}>
              <PlanPickerPage />
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>,
      )
    }
    const first = renderOnce()
    const toggle = await screen.findByRole('switch', { name: i18n.t('billing.picker.annualToggle') })
    toggle.click()
    expect(await screen.findByText(/3\.990\.000/)).toBeInTheDocument() // annual pro price
    // Navigate away and back — a fresh mount reads the persisted store, not useState(false).
    first.unmount()
    renderOnce()
    expect(await screen.findByText(/3\.990\.000/)).toBeInTheDocument()
    expect(screen.getByRole('switch', { name: i18n.t('billing.picker.annualToggle') })).toHaveAttribute('aria-checked', 'true')
  })
})
