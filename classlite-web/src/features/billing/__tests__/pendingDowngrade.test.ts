// Story 9-2b — Task 2 (AC6). The pendingDowngrade normalizer must fold BOTH wire
// shapes into one `PendingDowngrade | null`, and — the load-bearing case — treat the
// endpoint's empty-string `""` (not null) as "no downgrade scheduled".
import { describe, expect, test } from 'vitest'
import {
  normalizeSummaryPending,
  normalizeEndpointPending,
} from '../lib/pendingDowngrade'

describe('normalizeSummaryPending (GET /api/billing shape)', () => {
  test('null → null', () => {
    expect(normalizeSummaryPending(null)).toBeNull()
  })

  test('{ plan, effectiveAt } → the normalized shape', () => {
    expect(
      normalizeSummaryPending({
        plan: 'pro',
        effectiveAt: '2026-11-01T00:00:00+07:00',
      }),
    ).toEqual({ plan: 'pro', effectiveAt: '2026-11-01T00:00:00+07:00' })
  })

  // Code-review patch (2026-10-05): defend symmetrically with the endpoint adapter —
  // a contract-slip empty-string / off-enum plan must normalize to null, not render
  // "Downgrade to undefined …".
  test('empty-string plan → null (defensive, mirrors the endpoint adapter)', () => {
    expect(
      normalizeSummaryPending({
        plan: '' as never,
        effectiveAt: '',
      }),
    ).toBeNull()
  })

  test('an unknown plan string → null (defensive)', () => {
    expect(
      normalizeSummaryPending({
        plan: 'enterprise' as never,
        effectiveAt: '2026-11-01T00:00:00+07:00',
      }),
    ).toBeNull()
  })
})

describe('normalizeEndpointPending (downgrade/cancel shape, empty-string-when-none)', () => {
  test('empty-string pendingPlan → null (the gotcha #2 case)', () => {
    expect(
      normalizeEndpointPending({
        pendingPlan: '',
        pendingBillingCycle: '',
        effectiveAt: '',
      }),
    ).toBeNull()
  })

  test('null pendingPlan → null', () => {
    expect(
      normalizeEndpointPending({
        pendingPlan: null,
        pendingBillingCycle: null,
        effectiveAt: null,
      }),
    ).toBeNull()
  })

  test('a scheduled downgrade → the normalized shape', () => {
    expect(
      normalizeEndpointPending({
        pendingPlan: 'free',
        pendingBillingCycle: 'monthly',
        effectiveAt: '2026-11-01T00:00:00+07:00',
      }),
    ).toEqual({ plan: 'free', effectiveAt: '2026-11-01T00:00:00+07:00' })
  })

  test('an unknown pendingPlan string → null (defensive)', () => {
    expect(
      normalizeEndpointPending({
        pendingPlan: 'enterprise',
        pendingBillingCycle: 'monthly',
        effectiveAt: '2026-11-01T00:00:00+07:00',
      }),
    ).toBeNull()
  })
})
