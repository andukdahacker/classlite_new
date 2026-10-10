// Story 5.2b Task 8 (AC15) — read-only derivation + the 409/413 error map.
import { describe, expect, test } from 'vitest'
import { ApiError } from '@/lib/api-fetch'
import {
  deriveReadOnly,
  mapWriteError,
  readOnlyBannerCopy,
  readOnlyReasonKey,
} from '../attemptReadOnly'

const NOW = Date.parse('2026-08-04T00:00:00Z')

describe('deriveReadOnly (AC15)', () => {
  test('in_progress + open + no hard deadline → editable', () => {
    expect(
      deriveReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'open',
        hardDeadlineAt: null,
        serverNowMs: NOW,
      }),
    ).toEqual({ readOnly: false, reason: null })
  })

  test('a non-in_progress submission → read-only "submitted"', () => {
    expect(
      deriveReadOnly({
        submissionStatus: 'submitted',
        assignmentStatus: 'open',
        hardDeadlineAt: null,
        serverNowMs: NOW,
      }),
    ).toEqual({ readOnly: true, reason: 'submitted' })
  })

  test('a closed assignment → read-only "locked"', () => {
    expect(
      deriveReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'closed',
        hardDeadlineAt: null,
        serverNowMs: NOW,
      }),
    ).toEqual({ readOnly: true, reason: 'locked' })
  })

  test('a passed hard deadline → read-only "timeExpired" (server clock, not Date.now)', () => {
    expect(
      deriveReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'open',
        hardDeadlineAt: '2026-08-03T23:59:59Z', // 1s in the past
        serverNowMs: NOW,
      }),
    ).toEqual({ readOnly: true, reason: 'timeExpired' })
  })

  test('a future hard deadline does NOT lock', () => {
    expect(
      deriveReadOnly({
        submissionStatus: 'in_progress',
        assignmentStatus: 'open',
        hardDeadlineAt: '2026-08-04T01:00:00Z',
        serverNowMs: NOW,
      }).readOnly,
    ).toBe(false)
  })

  test('readOnlyReasonKey maps to the attempt.readonly.* namespace', () => {
    expect(readOnlyReasonKey('timeExpired')).toBe('attempt.readonly.timeExpired')
    expect(readOnlyReasonKey('locked')).toBe('attempt.readonly.locked')
    expect(readOnlyReasonKey('submitted')).toBe('attempt.readonly.submitted')
  })
})

describe('mapWriteError — the three 409 subcodes + 413 (AC15)', () => {
  test('TIME_EXPIRED → read-only timeExpired', () => {
    expect(mapWriteError(new ApiError(409, 'TIME_EXPIRED', 'm', 'r'))).toEqual({
      kind: 'readOnly',
      reason: 'timeExpired',
    })
  })
  test('SUBMISSION_LOCKED → read-only locked', () => {
    expect(mapWriteError(new ApiError(409, 'SUBMISSION_LOCKED', 'm', 'r'))).toEqual({
      kind: 'readOnly',
      reason: 'locked',
    })
  })
  test('SUBMISSION_NOT_EDITABLE → read-only submitted', () => {
    expect(mapWriteError(new ApiError(409, 'SUBMISSION_NOT_EDITABLE', 'm', 'r'))).toEqual({
      kind: 'readOnly',
      reason: 'submitted',
    })
  })
  test('413 PAYLOAD_TOO_LARGE → save error (NOT read-only)', () => {
    expect(mapWriteError(new ApiError(413, 'PAYLOAD_TOO_LARGE', 'm', 'r'))).toEqual({
      kind: 'saveError',
      messageKey: 'attempt.error.payloadTooLarge',
    })
  })
  test('an unrelated error → unknown', () => {
    expect(mapWriteError(new ApiError(500, 'INTERNAL_ERROR', 'm', 'r'))).toEqual({
      kind: 'unknown',
    })
    expect(mapWriteError(new Error('x'))).toEqual({ kind: 'unknown' })
  })
})

describe('readOnlyBannerCopy (Story 10.4 AC5, s64)', () => {
  const PAST = '2026-08-01T00:00:00Z' // before NOW
  const FUTURE = '2026-08-10T00:00:00Z' // after NOW

  test('timeExpired + a PASSED hard deadline → deadline-framed copy + extension hint', () => {
    expect(readOnlyBannerCopy('timeExpired', PAST, NOW)).toEqual({
      messageKey: 'attempt.readonly.deadlinePassed',
      hintKey: 'attempt.readonly.extensionHint',
    })
  })

  test('timeExpired with NO hard deadline (timer/racing-write) → keeps the timer copy, no hint', () => {
    expect(readOnlyBannerCopy('timeExpired', null, NOW)).toEqual({
      messageKey: 'attempt.readonly.timeExpired',
      hintKey: null,
    })
  })

  test('timeExpired + a FUTURE hard deadline (not yet passed) → keeps the timer copy', () => {
    expect(readOnlyBannerCopy('timeExpired', FUTURE, NOW)).toEqual({
      messageKey: 'attempt.readonly.timeExpired',
      hintKey: null,
    })
  })

  test('a malformed hard deadline is treated as already-passed (mirrors deriveReadOnly)', () => {
    expect(readOnlyBannerCopy('timeExpired', 'not-a-date', NOW)).toEqual({
      messageKey: 'attempt.readonly.deadlinePassed',
      hintKey: 'attempt.readonly.extensionHint',
    })
  })

  test('submitted / locked keep their own key regardless of the deadline, no hint', () => {
    expect(readOnlyBannerCopy('submitted', PAST, NOW)).toEqual({
      messageKey: 'attempt.readonly.submitted',
      hintKey: null,
    })
    expect(readOnlyBannerCopy('locked', PAST, NOW)).toEqual({
      messageKey: 'attempt.readonly.locked',
      hintKey: null,
    })
  })
})
