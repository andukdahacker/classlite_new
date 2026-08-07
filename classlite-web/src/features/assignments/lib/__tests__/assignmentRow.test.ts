// Story 5.2c (AC4/AC5) — pure row-model unit tests, authored RED-first.
// Covers attemptRouteForSkill (every ExerciseSkill), rowStatus (every
// SubmissionStatus incl. null), and isOverdue (deadline × status × clock
// boundary). No React, no MSW — pure functions.
import { describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import {
  attemptRouteForSkill,
  isOverdue,
  rowStatus,
} from '@/features/assignments/lib/assignmentRow'

type ExerciseSkill = components['schemas']['ExerciseSkill']
type SubmissionStatus = components['schemas']['SubmissionStatus']

const ASSIGNMENT_ID = '00000000-0000-0000-0000-0000000000a1'

describe('attemptRouteForSkill (AC4)', () => {
  test.each<ExerciseSkill>(['reading', 'listening', 'vocabulary', 'grammar'])(
    'quiz skill %s deep-links to the 5.2b attempt route',
    (skill) => {
      expect(attemptRouteForSkill(skill, ASSIGNMENT_ID)).toBe(
        `/assignments/${ASSIGNMENT_ID}/attempt`,
      )
    },
  )

  test('writing deep-links to the 5.3 writing attempt route', () => {
    expect(attemptRouteForSkill('writing', ASSIGNMENT_ID)).toBe(
      `/assignments/${ASSIGNMENT_ID}/write`,
    )
  })

  test.each<ExerciseSkill>(['speaking', 'general'])(
    'skill %s whose attempt UI is not built yet returns null ("Available soon")',
    (skill) => {
      expect(attemptRouteForSkill(skill, ASSIGNMENT_ID)).toBeNull()
    },
  )

  test('unknown skill (server/type version skew) fails safe to null, never undefined', () => {
    // Cast: deliberately model a value outside the generated ExerciseSkill
    // union to exercise the runtime fail-safe default (a broken skew value must
    // degrade to "Available soon", never emit `<Link to={undefined}>`).
    const skew = 'pronunciation' as ExerciseSkill
    expect(attemptRouteForSkill(skew, ASSIGNMENT_ID)).toBeNull()
  })
})

describe('rowStatus (AC4)', () => {
  test('null (not started) → Start CTA', () => {
    expect(rowStatus(null)).toEqual({
      statusKey: 'assignments.status.notStarted',
      cta: 'start',
    })
  })

  test('in_progress → Continue CTA', () => {
    expect(rowStatus('in_progress')).toEqual({
      statusKey: 'assignments.status.inProgress',
      cta: 'continue',
    })
  })

  test.each<SubmissionStatus>(['submitted', 'ai_processing'])(
    '%s → Submitted status, read-only view CTA',
    (status) => {
      expect(rowStatus(status)).toEqual({
        statusKey: 'assignments.status.submitted',
        cta: 'view',
      })
    },
  )

  test('graded → Graded badge, no actionable CTA (result deferred to 5.5)', () => {
    expect(rowStatus('graded')).toEqual({
      statusKey: 'assignments.status.graded',
      cta: 'none',
    })
  })

  test('unknown status (server/type version skew) fails safe to a no-action row, never undefined', () => {
    // Cast: model a value outside the generated SubmissionStatus union to
    // exercise the runtime fail-safe default — it must return a valid RowStatus
    // (no CTA), never `undefined`, which would crash the list on destructure.
    const skew = 'returned' as SubmissionStatus
    expect(rowStatus(skew)).toEqual({
      statusKey: 'assignments.status.submitted',
      cta: 'none',
    })
  })
})

describe('isOverdue (AC5)', () => {
  const SERVER_NOW = '2026-08-04T00:00:00Z'
  const PAST = '2026-08-01T00:00:00Z'
  const FUTURE = '2026-08-10T00:00:00Z'

  test('past deadline + not-started → overdue', () => {
    expect(isOverdue(PAST, null, SERVER_NOW)).toBe(true)
  })

  test('past deadline + in_progress → overdue', () => {
    expect(isOverdue(PAST, 'in_progress', SERVER_NOW)).toBe(true)
  })

  test.each<SubmissionStatus>(['submitted', 'ai_processing', 'graded'])(
    'past deadline but already %s → NOT overdue (submission closes the window)',
    (status) => {
      expect(isOverdue(PAST, status, SERVER_NOW)).toBe(false)
    },
  )

  test('future deadline + not-started → NOT overdue', () => {
    expect(isOverdue(FUTURE, null, SERVER_NOW)).toBe(false)
  })

  test('deadline exactly equal to server time → NOT overdue (strictly past only)', () => {
    expect(isOverdue(SERVER_NOW, null, SERVER_NOW)).toBe(false)
  })

  test('falls back to wall-clock when serverTime is omitted', () => {
    const wayPast = '2000-01-01T00:00:00Z'
    expect(isOverdue(wayPast, null)).toBe(true)
  })
})
