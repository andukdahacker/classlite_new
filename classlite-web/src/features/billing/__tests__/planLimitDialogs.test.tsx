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
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
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

function renderDialog(ui: React.ReactElement, role: Role | null = null): void {
  render(
    <I18nextProvider i18n={i18n}>
      <RoleProvider value={role}>{ui}</RoleProvider>
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
  test('owner: names the limit + current/max and shows the "See plans" CTA (NO "Upgrade" verb)', () => {
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
    expect(screen.getByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  test('teacher (canManageBilling=false): shows "ask your owner", CTA ABSENT (C11 negative half)', () => {
    renderDialog(<PlanLimitExceededDialog open error={planLimit409(false)} />)
    expect(screen.getByText(i18n.t('billing.error.askOwner'))).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: i18n.t('billing.dashboard.seePlans') })).not.toBeInTheDocument()
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
