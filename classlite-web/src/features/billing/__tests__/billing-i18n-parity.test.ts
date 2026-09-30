// Story 9-1b — C13 (P0). Every billing.* string the FE renders must resolve in
// BOTH en and vi (a missing vi key is a broken experience for half the users,
// UX-2) with matching interpolation tokens. Follows the landing-parity + R38
// precedent using the shipped `assertI18nParity` helpers.
import { describe, test } from 'vitest'
import {
  assertI18nParity,
  assertI18nInterpolationParity,
} from '@/lib/test/i18n-parity'

const BILLING_KEYS = [
  'billing.vatCaption',
  'billing.picker.title',
  'billing.picker.monthlyLabel',
  'billing.picker.annualLabel',
  'billing.picker.annualToggle',
  'billing.picker.annualSavings',
  'billing.picker.currentPlan',
  'billing.picker.talkToUs',
  'billing.picker.perMonth',
  'billing.picker.perYear',
  'billing.picker.vatSplit',
  'billing.picker.limits.teachers',
  'billing.picker.limits.classes',
  'billing.picker.limits.studentsPerClass',
  'billing.picker.limits.aiCredits',
  'billing.picker.limits.storage',
  'billing.dashboard.currentPlan',
  'billing.dashboard.cycle.monthly',
  'billing.dashboard.cycle.annual',
  'billing.dashboard.periodEnd',
  'billing.dashboard.seePlans',
  'billing.dashboard.aiNotIncluded',
  'billing.dashboard.meterLabel.teacherSeats',
  'billing.dashboard.meterLabel.classes',
  'billing.dashboard.meterLabel.storage',
  'billing.dashboard.meterLabel.aiCredits',
  'billing.meter.unlimited',
  'billing.meter.resetAt',
  'billing.error.planLimitExceeded',
  'billing.error.planLimitAccessKept',
  'billing.error.planLimitUsage',
  'billing.error.insufficientCredits',
  'billing.error.insufficientCreditsHint',
  'billing.error.insufficientCreditsBody',
  'billing.error.askOwner',
  'billing.error.generic',
  'billing.error.loadFailed',
  'billing.error.retry',
  'billing.banner.studentCount',
  'billing.banner.splitSuggestion',
  'billing.banner.dismiss',
] as const

describe('billing.* i18n coverage (C13)', () => {
  test('every billing key exists in en AND vi', () => {
    assertI18nParity(BILLING_KEYS)
  })

  test('interpolation tokens match across en and vi', () => {
    assertI18nInterpolationParity(BILLING_KEYS)
  })
})
