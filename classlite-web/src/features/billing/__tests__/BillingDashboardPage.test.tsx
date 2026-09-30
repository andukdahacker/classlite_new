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
import { render, screen } from '@testing-library/react'
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
