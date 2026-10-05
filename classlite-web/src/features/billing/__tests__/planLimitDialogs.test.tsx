// ATDD RED-PHASE — Story 9-1b, Task 5 (latent 409/402 hard-block dialogs + runtime
// type-guards). Matrix C7/C8/C11 + AC14/AC15/AC16 + D-9-1b-1/D-9-1b-4.
//
// RED signals (compile-fail via tsc -b):
//   1. `@/features/billing/lib/typeGuards` does not exist yet (TS2307).
//   2. `@/features/billing/lib/errorKey` does not exist yet (TS2307).
//   3. `@/features/billing/components/PlanLimitExceededDialog` +
//      `InsufficientCreditsDialog` do not exist yet (TS2307).
//
// NOTE (Murat / D-9-1b-4): these details objects are the ONLY source of truth for the
// dialogs (enforcement is dark-launched OFF → no live 409/402 in prod; MSW/synthetic
// ApiError is the only signal). The fixtures below mirror error_mapper.go verbatim:
//   409 details = { limit, current, max, canManageBilling }
//   402 details = { available, required }
// `ApiError.details` is typed `unknown`, so the dialogs read it through the runtime
// guards — this test proves the guards DISCRIMINATE on `code` (the negative-half is the
// bug catcher: a 402 with an unknown code must fall through to the generic path).
//
// GREEN-PHASE SEAMS:
//   - features/billing/lib/typeGuards.ts (isPlanLimitDetails / isInsufficientCreditsDetails)
//   - features/billing/lib/errorKey.ts (billing-local errorKey(error): code → i18n key,
//     copy keyed on `code`, NOT error.message which is an English literal server-side)
//   - features/billing/components/{PlanLimitExceededDialog,InsufficientCreditsDialog}.tsx
//     mounted at a GLOBAL ApiError seam (D-9-1b-3), wired to the enrolment mutation only.
//   - D-9-1b-1: owner CTA = "See plans" (NOT "Upgrade"); teacher = "ask your owner", no CTA.
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { http, HttpResponse } from 'msw'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { RoleProvider } from '@/hooks/RoleContext'
import type { Role } from '@/features/auth/api/authKeys'
// RED: these modules do not exist yet.
import { isPlanLimitDetails, isInsufficientCreditsDetails } from '@/features/billing/lib/typeGuards'
import { PlanLimitExceededDialog } from '@/features/billing/components/PlanLimitExceededDialog'
import { InsufficientCreditsDialog } from '@/features/billing/components/InsufficientCreditsDialog'

const planLimit409 = (canManageBilling: boolean) =>
  new ApiError(409, 'PLAN_LIMIT_EXCEEDED', "You've reached your plan limit — upgrade to add more.", 'req-1', {
    limit: 'STUDENTS_PER_CLASS',
    current: 20,
    max: 20,
    canManageBilling,
  })

const credits402 = new ApiError(402, 'INSUFFICIENT_CREDITS', 'Not enough AI credits — upgrade or buy an add-on.', 'req-2', {
  available: 3,
  required: 10,
})

// 9-2b: PlanLimitExceededDialog's owner branch now reads the current plan (to open the
// s71 upgrade modal for the next tier), so the dialog needs a QueryClientProvider + a
// billing summary. A pro summary → owner sees "Upgrade to Studio".
const PRO_SUMMARY = {
  plan: 'pro', billingCycle: 'monthly', status: 'active', isFree: false, creditsApplicable: true,
  currentPeriodStart: '2026-09-01T00:00:00+07:00', currentPeriodEnd: '2026-10-01T00:00:00+07:00',
  limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
  usage: {
    teacherSeats: { current: 3, max: 10, approaching: false },
    classes: { current: 4, max: null, approaching: false },
    aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' },
    storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false },
  },
  nextInvoice: null, paymentMethod: null, pendingDowngrade: null,
}

beforeEach(() => {
  server.use(
    http.get('*/api/billing', () => HttpResponse.json({ data: PRO_SUMMARY, meta: { requestId: 't' } })),
    http.get('*/api/billing/plans', () => HttpResponse.json({ data: { plans: [] }, meta: { requestId: 't' } })),
  )
})
afterEach(() => server.resetHandlers())

function renderDialog(ui: React.ReactElement, role: Role | null = null): void {
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>
          <RoleProvider value={role}>{ui}</RoleProvider>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  )
}

describe('billing type-guards discriminate on the details shape (AC16 / D-9-1b-4)', () => {
  test('isPlanLimitDetails accepts the 409 object and rejects the 402 object', () => {
    expect(isPlanLimitDetails(planLimit409(true).details)).toBe(true)
    expect(isPlanLimitDetails(credits402.details)).toBe(false)
    expect(isPlanLimitDetails(null)).toBe(false)
    expect(isPlanLimitDetails([{ field: 'x', message: 'y' }])).toBe(false) // a FieldError[] is not a plan-limit
  })

  test('isInsufficientCreditsDetails accepts the 402 object and rejects the 409 object', () => {
    expect(isInsufficientCreditsDetails(credits402.details)).toBe(true)
    expect(isInsufficientCreditsDetails(planLimit409(true).details)).toBe(false)
  })
})

describe('PlanLimitExceededDialog — 409 (C7 / C11 / AC14 / D-9-1b-1)', () => {
  test('owner: names the limit + current/max and (9-2b) offers a live "Upgrade" CTA to the next tier', async () => {
    renderDialog(<PlanLimitExceededDialog open error={planLimit409(true)} />)
    expect(screen.getByText(i18n.t('billing.error.planLimitExceeded'))).toBeInTheDocument()
    // AC14: the dialog names WHICH limit was hit (STUDENTS_PER_CLASS), not just the ratio.
    expect(
      screen.getByText(
        i18n.t('billing.error.planLimitNamed', {
          name: i18n.t('billing.error.limitName.STUDENTS_PER_CLASS'),
        }),
      ),
    ).toBeInTheDocument()
    expect(screen.getByText(/20/)).toBeInTheDocument() // current/max surfaced
    // 9-2b AC2: once the summary loads, the owner CTA is a real "Upgrade to {next tier}"
    // (the dead 9-1b "Talk to us" / picker-only link is gone — purchase is live).
    const upgrade = await screen.findByTestId('plan-limit-upgrade')
    expect(upgrade).toHaveTextContent(i18n.t('billing.action.upgradeTo', { tier: 'Studio' }))
  })

  test('teacher (canManageBilling=false): shows "ask your owner", CTA ABSENT (C11 negative half)', () => {
    renderDialog(<PlanLimitExceededDialog open error={planLimit409(false)} />)
    expect(screen.getByText(i18n.t('billing.error.askOwner'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).not.toBeInTheDocument()
  })

  // Code-review patch (2026-10-05): the app-wide dialog must NOT fire the owner-only
  // GET /api/billing for a non-owner (it would be a guaranteed 403 + console noise).
  test('non-owner: does NOT fire the owner-only billing summary request', async () => {
    let calls = 0
    server.use(
      http.get('*/api/billing', () => {
        calls += 1
        return HttpResponse.json({ data: PRO_SUMMARY, meta: { requestId: 't' } })
      }),
    )
    renderDialog(<PlanLimitExceededDialog open error={planLimit409(false)} />)
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(calls).toBe(0)
  })

  // Code-review patch (2026-10-05): opening the upgrade modal must close the limit dialog,
  // so the two Radix dialogs never stack (double focus-trap).
  test('owner: opening the upgrade modal removes the limit dialog (no stacked dialogs)', async () => {
    renderDialog(<PlanLimitExceededDialog open error={planLimit409(true)} />)
    await userEvent.click(await screen.findByTestId('plan-limit-upgrade'))
    await waitFor(() =>
      expect(screen.queryByTestId('plan-limit-exceeded-dialog')).not.toBeInTheDocument(),
    )
  })

  test('malformed detail → neutral generic message, NOT the non-owner "ask owner" path (P4)', () => {
    const malformed = new ApiError(409, 'PLAN_LIMIT_EXCEEDED', 'x', 'req-3', { unexpected: true })
    renderDialog(<PlanLimitExceededDialog open error={malformed} />)
    expect(screen.getByText(i18n.t('billing.error.generic'))).toBeInTheDocument()
    // Neither role-branch copy leaks on a malformed detail.
    expect(screen.queryByText(i18n.t('billing.error.askOwner'))).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).not.toBeInTheDocument()
  })
})

describe('InsufficientCreditsDialog — 402 (C8 / AC15 / P1 role-gate)', () => {
  test('names the gap: available AND required both surfaced', () => {
    renderDialog(<InsufficientCreditsDialog open error={credits402} />, 'owner')
    expect(screen.getByText(i18n.t('billing.error.insufficientCredits'))).toBeInTheDocument()
    expect(screen.getByText(/3/)).toBeInTheDocument() // available
    expect(screen.getByText(/10/)).toBeInTheDocument() // required
  })

  test('owner: shows the "See plans" CTA', () => {
    renderDialog(<InsufficientCreditsDialog open error={credits402} />, 'owner')
    expect(screen.getByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).toBeInTheDocument()
    expect(screen.queryByText(i18n.t('billing.error.askOwner'))).not.toBeInTheDocument()
  })

  test('teacher (non-owner): shows "ask your owner", the owner-only "See plans" CTA ABSENT (P1)', () => {
    renderDialog(<InsufficientCreditsDialog open error={credits402} />, 'teacher')
    expect(screen.getByText(i18n.t('billing.error.askOwner'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).not.toBeInTheDocument()
  })
})
