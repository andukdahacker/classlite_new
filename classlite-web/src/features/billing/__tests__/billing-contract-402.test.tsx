// Story 9-2b — FU-9-CONTRACT-402 (AC15). The CONTRACT proof that gates the prod
// arming flip (AC20): the real 409/402 `details` shapes the wired call sites receive
// must match what 9-1b's dialogs + type-guards were built against.
//
//   409 PLAN_LIMIT_EXCEEDED → { limit, current, max, canManageBilling }
//       limit ∈ TEACHER_SEATS | CLASSES | STUDENTS_PER_CLASS | STORAGE | AI_CREDITS
//   402 INSUFFICIENT_CREDITS → { available, required }
//
// `ApiError.details` is `unknown` and the generated `ErrorBody.details` schema does NOT
// describe these objects (typeGuards.ts) — so the guards are the SOLE contract boundary.
// This test freezes (a) the guards accept every real shape and discriminate the wrong
// ones, and (b) the dialogs render the fields. If the server shape drifts, this fails —
// do NOT arm enforcement (AC20) with this red.
import type { ReactElement } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { render, screen, cleanup } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { MemoryRouter } from 'react-router'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { ApiError } from '@/lib/api-fetch'
import { createTestQueryClient } from '@/lib/query-client'
import {
  isPlanLimitDetails,
  isInsufficientCreditsDetails,
} from '../lib/typeGuards'
import { PlanLimitExceededDialog } from '../components/PlanLimitExceededDialog'
import { InsufficientCreditsDialog } from '../components/InsufficientCreditsDialog'

// The exact limit enum the 9-1b dialog + banner key off (error_mapper.go verbatim).
const LIMIT_CODES = ['TEACHER_SEATS', 'CLASSES', 'STUDENTS_PER_CLASS', 'STORAGE', 'AI_CREDITS'] as const

function wrap(ui: ReactElement): ReactElement {
  return (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={createTestQueryClient()}>
        <MemoryRouter>{ui}</MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
}

afterEach(() => cleanup())

describe('FU-9-CONTRACT-402 — 409 PLAN_LIMIT_EXCEEDED detail shape', () => {
  test.each(LIMIT_CODES)('isPlanLimitDetails accepts the real shape for limit=%s', (limit) => {
    expect(isPlanLimitDetails({ limit, current: 3, max: 3, canManageBilling: true })).toBe(true)
    // max null (an unlimited ceiling hit by a non-count bound) is valid too.
    expect(isPlanLimitDetails({ limit, current: 3, max: null, canManageBilling: false })).toBe(true)
  })

  test('isPlanLimitDetails REJECTS the 402 shape, a FieldError[], and null (discrimination)', () => {
    expect(isPlanLimitDetails({ available: 0, required: 1 })).toBe(false)
    expect(isPlanLimitDetails([{ field: 'x', message: 'y' }])).toBe(false)
    expect(isPlanLimitDetails(null)).toBe(false)
  })

  test('the dialog names the hit limit + renders current/max for the real shape', async () => {
    const error = new ApiError(409, 'PLAN_LIMIT_EXCEEDED', 'm', 'r', {
      limit: 'TEACHER_SEATS',
      current: 3,
      max: 3,
      canManageBilling: true,
    })
    render(wrap(<PlanLimitExceededDialog open error={error} />))
    const dialog = await screen.findByTestId('plan-limit-exceeded-dialog')
    expect(dialog).toHaveTextContent(i18n.t('billing.error.limitName.TEACHER_SEATS'))
    expect(dialog).toHaveTextContent(i18n.t('billing.error.planLimitUsage', { current: 3, max: 3 }))
  })
})

describe('FU-9-CONTRACT-402 — 402 INSUFFICIENT_CREDITS detail shape', () => {
  test('isInsufficientCreditsDetails accepts { available, required } and rejects the 409 shape', () => {
    expect(isInsufficientCreditsDetails({ available: 0, required: 5 })).toBe(true)
    expect(isInsufficientCreditsDetails({ limit: 'AI_CREDITS', current: 0, max: 0, canManageBilling: true })).toBe(false)
    expect(isInsufficientCreditsDetails(null)).toBe(false)
  })

  test('the dialog renders available vs required for the real shape', async () => {
    const error = new ApiError(402, 'INSUFFICIENT_CREDITS', 'm', 'r', { available: 2, required: 7 })
    render(wrap(<InsufficientCreditsDialog open error={error} />))
    const dialog = await screen.findByTestId('insufficient-credits-dialog')
    expect(dialog).toHaveTextContent(i18n.t('billing.error.insufficientCreditsBody', { available: 2, required: 7 }))
  })
})
