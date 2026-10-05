// Story 9-1b — C14 (P0 for the picker: the monthly/annual toggle is a custom
// role="switch" control). axe-core structural audit on s68 + s69 + both latent
// dialogs (TEST-FE-5). MSW at the HTTP boundary (TEST-FE-1); real QueryClient.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
import { PlanPickerPage } from '../PlanPickerPage'
import { BillingDashboardPage } from '../BillingDashboardPage'
import { PlanLimitExceededDialog } from '../components/PlanLimitExceededDialog'
import { InsufficientCreditsDialog } from '../components/InsufficientCreditsDialog'
import { UpgradeModal } from '../components/UpgradeModal'
import { DowngradeConfirmModal } from '../components/DowngradeConfirmModal'
import { AddonPacksModal } from '../components/AddonPacksModal'

type PlanCatalogEntry = components['schemas']['PlanCatalogEntry']
type BillingSummary = components['schemas']['BillingSummary']

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

// Base-UI's Dialog injects invisible focus-guard sentinels with role="button"
// and no accessible name — an upstream primitive detail that trips
// `aria-command-name`. Scope only that rule off so the audit still validates OUR
// dialog markup (title, description, the "See plans" link, the close button).
const DIALOG_AXE_OPTIONS = {
  rules: { 'aria-command-name': { enabled: false } },
} as const

const PLANS: PlanCatalogEntry[] = [
  {
    plan: 'pro',
    limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
    priceMonthlyVnd: 399000,
    priceAnnualVnd: 3990000,
    vat: { monthlySubtotal: 362727, monthlyVat: 36273, annualSubtotal: 3627273, annualVat: 362727 },
  },
]

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

function seedOwner(): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: 'u-owner', email: 'owner@example.com', fullName: 'Owner', emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role: 'owner' as Role,
  })
}

function wrap(ui: React.ReactElement): React.ReactElement {
  seedOwner()
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

beforeEach(() => {
  server.use(
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: PLANS }, meta: { requestId: 't' } })),
    http.get('*/api/billing', () => HttpResponse.json({ data: SUMMARY, meta: { requestId: 't' } })),
  )
})
afterEach(() => {
  cleanup()
  queryClient.clear()
})

describe('billing surfaces — axe clean (C14)', () => {
  test('plan picker has no accessibility violations', async () => {
    const { container } = render(wrap(<PlanPickerPage />))
    await screen.findByTestId('plan-card-pro')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('billing dashboard has no accessibility violations', async () => {
    const { container } = render(wrap(<BillingDashboardPage />))
    await screen.findByTestId('billing-dashboard')
    expect(await axe(container)).toHaveNoViolations()
  })

  test('plan-limit-exceeded dialog has no accessibility violations', async () => {
    const error = new ApiError(409, 'PLAN_LIMIT_EXCEEDED', 'm', 'r', {
      limit: 'STUDENTS_PER_CLASS',
      current: 20,
      max: 20,
      canManageBilling: true,
    })
    const { baseElement } = render(wrap(<PlanLimitExceededDialog open error={error} />))
    await screen.findByTestId('plan-limit-exceeded-dialog')
    expect(await axe(baseElement, DIALOG_AXE_OPTIONS)).toHaveNoViolations()
  })

  test('insufficient-credits dialog has no accessibility violations', async () => {
    const error = new ApiError(402, 'INSUFFICIENT_CREDITS', 'm', 'r', { available: 3, required: 10 })
    const { baseElement } = render(wrap(<InsufficientCreditsDialog open error={error} />))
    await screen.findByTestId('insufficient-credits-dialog')
    expect(await axe(baseElement, DIALOG_AXE_OPTIONS)).toHaveNoViolations()
  })

  // Story 9-2b — the three new dialogs (AC19).
  test('upgrade modal has no accessibility violations', async () => {
    server.use(
      http.get('*/api/billing/proration-preview', () =>
        HttpResponse.json({ data: { targetPlan: 'pro', targetBillingCycle: 'monthly', subtotalVnd: 362727, vatVnd: 36273, totalVnd: 399000, creditAppliedVnd: 0, chargedTodayVnd: 399000 }, meta: { requestId: 't' } }),
      ),
    )
    const { baseElement } = render(wrap(<UpgradeModal open onClose={() => {}} targetPlan="pro" billingCycle="monthly" />))
    await screen.findByTestId('upgrade-modal-charge')
    expect(await axe(baseElement, DIALOG_AXE_OPTIONS)).toHaveNoViolations()
  })

  test('downgrade-confirm modal has no accessibility violations', async () => {
    const { baseElement } = render(
      wrap(<DowngradeConfirmModal open onClose={() => {}} targetPlan="free" billingCycle="monthly" effectiveAt="2026-10-01T00:00:00+07:00" />),
    )
    await screen.findByTestId('downgrade-confirm-modal')
    expect(await axe(baseElement, DIALOG_AXE_OPTIONS)).toHaveNoViolations()
  })

  test('add-on packs modal has no accessibility violations', async () => {
    server.use(
      http.get('*/api/billing/addons', () =>
        HttpResponse.json({ data: { addons: [{ packId: 'credits_100', credits: 100, priceVnd: 99000, subtotalVnd: 90000, vatVnd: 9000 }] }, meta: { requestId: 't' } }),
      ),
    )
    const { baseElement } = render(wrap(<AddonPacksModal open onClose={() => {}} />))
    await screen.findByTestId('addon-pack-credits_100')
    expect(await axe(baseElement, DIALOG_AXE_OPTIONS)).toHaveNoViolations()
  })
})
