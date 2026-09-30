// ATDD RED-PHASE — Story 9-1b, Task 2/3 (owner-only routes s68/s69). Matrix C6 +
// AC6/AC11/AC20. TEST-FE-6 negative-security assertion: billing data ABSENT from the
// DOM for non-owners, not merely visually hidden.
//
// RED signals (compile-fail via tsc -b):
//   1. `@/features/billing/PlanPickerPage` + `BillingDashboardPage` do not exist (TS2307).
// NOTE: sectionNameKey="billing" ALREADY exists in the SectionNameKey union and the
// app.permissionDenied.section.billing.* copy already ships (en/vi.json:117) — so unlike
// 7-1b's people gate, this file's ONLY red signal is the missing page modules.
//
// GREEN-PHASE SEAMS:
//   - routes.tsx: /settings/billing + /settings/billing/plans behind
//     RouteRoleGate allowedRoles={['owner']} requiredRolesForCopy={['owner']}
//     sectionNameKey="billing" (standalone routes — settings tab union is closed, D-9-1b).
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter, Route, Routes } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { queryClient, createTestQueryClient } from '@/lib/query-client'
import RouteRoleGate from '@/components/shared/RouteRoleGate'
import { authKeys, type Role, type Session } from '@/features/auth/api/authKeys'
// RED: these modules do not exist yet.
import { BillingDashboardPage } from '@/features/billing/BillingDashboardPage'
import { PlanPickerPage } from '@/features/billing/PlanPickerPage'

const CENTER_ID = '00000000-0000-0000-0000-000000000001'

function seed(role: Role): void {
  queryClient.setQueryData<Session>(authKeys.session(), {
    user: { id: `u-${role}`, email: `${role}@example.com`, fullName: role, emailVerified: true },
    accessToken: 'a.b.c',
    center: { id: CENTER_ID, name: 'Saigon English', shortCode: 'saigon', brandColor: null, logoUrl: null, timezone: 'Asia/Ho_Chi_Minh' },
    role,
  })
}

function renderBillingAt(path: string, role: Role): void {
  seed(role)
  server.use(
    http.get('*/api/billing', () => HttpResponse.json({ data: { plan: 'pro', billingCycle: 'monthly', status: 'active', isFree: false, creditsApplicable: true, currentPeriodStart: '2026-09-01T00:00:00+07:00', currentPeriodEnd: '2026-10-01T00:00:00+07:00', limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 }, usage: { teacherSeats: { current: 3, max: 10, approaching: false }, classes: { current: 4, max: null, approaching: false }, aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' }, storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false } }, SECRET_PLAN_NAME: 'pro' }, meta: { requestId: 't' } })),
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: [] }, meta: { requestId: 't' } })),
  )
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route
              element={<RouteRoleGate allowedRoles={['owner']} requiredRolesForCopy={['owner']} sectionNameKey="billing" />}
            >
              <Route path="/settings/billing" element={<BillingDashboardPage />} />
              <Route path="/settings/billing/plans" element={<PlanPickerPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

afterEach(() => {
  queryClient.clear()
})

describe('billing routes — owner-only gate (C6 / AC6 / AC11 / AC20)', () => {
  test('owner sees the billing dashboard', async () => {
    renderBillingAt('/settings/billing', 'owner')
    expect(await screen.findByTestId('billing-dashboard')).toBeInTheDocument()
  })

  test.each<Role>(['teacher', 'student', 'admin'])(
    '%s is denied both billing routes: PermissionDenied billing copy shown AND no billing data in DOM',
    async (role) => {
      renderBillingAt('/settings/billing', role)
      // Positive: the shared 'billing' permission-denied section header.
      expect(await screen.findByTestId('permission-denied-section-header')).toHaveTextContent(
        i18n.t('app.permissionDenied.section.billing.header'),
      )
      // Negative-security (TEST-FE-6): the billing surface + any leaked payload is ABSENT.
      expect(screen.queryByTestId('billing-dashboard')).not.toBeInTheDocument()
      expect(screen.queryByTestId('plan-usage-meter-aiCredits')).not.toBeInTheDocument()
      // Even a raw leaked field from the summary payload must not reach the DOM.
      expect(screen.queryByText(/SECRET_PLAN_NAME/)).not.toBeInTheDocument()
    },
  )

  test('non-owner denied the plan picker too', async () => {
    renderBillingAt('/settings/billing/plans', 'teacher')
    expect(await screen.findByTestId('permission-denied-section-header')).toBeInTheDocument()
    expect(screen.queryByTestId('plan-card-pro')).not.toBeInTheDocument()
  })
})
