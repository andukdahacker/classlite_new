// Story 5.2b Task 5 (AC11/AC11a/AC20) — the remaining-seconds table + monotonic
// server clock, RED-first (WF-8 #1). Pure, no fake timers.
import { describe, expect, test } from 'vitest'
import {
  computeRemainingSeconds,
  createServerClock,
  formatRemaining,
  isExpired,
  timerWarningLevel,
} from '../attemptTimer'

const STARTED = '2026-08-04T00:00:00.000Z'
const STARTED_MS = Date.parse(STARTED)

describe('computeRemainingSeconds — the remaining table (WF-8 #1)', () => {
  test('untimed (timeBudgetSeconds null) → null, no auto-submit', () => {
    expect(computeRemainingSeconds(STARTED, null, STARTED_MS)).toBeNull()
  })

  test('exactly at the deadline → 0', () => {
    expect(computeRemainingSeconds(STARTED, 60, STARTED_MS + 60_000)).toBe(0)
  })

  test('1s before the deadline → 1', () => {
    expect(computeRemainingSeconds(STARTED, 60, STARTED_MS + 59_000)).toBe(1)
  })

  test('a fractional second rounds UP (0.5s left → 1)', () => {
    expect(computeRemainingSeconds(STARTED, 60, STARTED_MS + 59_500)).toBe(1)
  })

  test('past the deadline → clamped at 0, never negative', () => {
    expect(computeRemainingSeconds(STARTED, 60, STARTED_MS + 120_000)).toBe(0)
  })

  test('full budget at start', () => {
    expect(computeRemainingSeconds(STARTED, 1800, STARTED_MS)).toBe(1800)
  })
})

describe('isExpired', () => {
  test('untimed is never expired', () => {
    expect(isExpired(STARTED, null, STARTED_MS + 10_000_000)).toBe(false)
  })
  test('at/after the deadline is expired; before is not', () => {
    expect(isExpired(STARTED, 60, STARTED_MS + 60_000)).toBe(true)
    expect(isExpired(STARTED, 60, STARTED_MS + 59_000)).toBe(false)
  })
})

describe('createServerClock — monotonic, skew-immune (AC11)', () => {
  test('advances by the performance.now() delta from the server anchor', () => {
    let perf = 1000
    const clock = createServerClock(STARTED, perf, () => perf)
    expect(clock()).toBe(STARTED_MS) // no delta yet
    perf = 1000 + 5_000 // 5s of monotonic time elapsed
    expect(clock()).toBe(STARTED_MS + 5_000)
  })

  test('is independent of Date.now (the wall clock never feeds it)', () => {
    let perf = 0
    const clock = createServerClock(STARTED, 0, () => perf)
    perf = 30_000
    // Drives remaining purely off the injected monotonic source.
    expect(computeRemainingSeconds(STARTED, 60, clock())).toBe(30)
  })
})

describe('timerWarningLevel (AC20)', () => {
  test('normal above 5:00, amber at/below 5:00, red at/below 1:00', () => {
    expect(timerWarningLevel(600)).toBe('normal')
    expect(timerWarningLevel(300)).toBe('amber')
    expect(timerWarningLevel(120)).toBe('amber')
    expect(timerWarningLevel(60)).toBe('red')
    expect(timerWarningLevel(5)).toBe('red')
    expect(timerWarningLevel(null)).toBe('normal')
  })
})

describe('formatRemaining', () => {
  test('M:SS under an hour, H:MM:SS past it', () => {
    expect(formatRemaining(0)).toBe('0:00')
    expect(formatRemaining(5)).toBe('0:05')
    expect(formatRemaining(65)).toBe('1:05')
    expect(formatRemaining(600)).toBe('10:00')
    expect(formatRemaining(3661)).toBe('1:01:01')
  })
})
