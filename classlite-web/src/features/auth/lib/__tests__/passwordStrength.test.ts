/**
 * scorePassword contract — 8 tests per Story 1-8 AC1.
 *
 * Pure function; no jsdom required.
 */
import { describe, expect, test } from 'vitest'
import { scorePassword } from '@/features/auth/lib/passwordStrength'

describe('scorePassword (Story 1-8 AC1)', () => {
  test('empty input returns 0', () => {
    expect(scorePassword('')).toBe(0)
  })

  test('less than 8 chars always returns 1 (below project min-length)', () => {
    expect(scorePassword('abc')).toBe(1)
    expect(scorePassword('A1!')).toBe(1)
    expect(scorePassword('1234567')).toBe(1)
  })

  test('lowercase-only at length 8+ scores 1 (no diversity)', () => {
    expect(scorePassword('passwordlower')).toBe(1)
  })

  test('lowercase + number at length 8+ scores 2 (one entropy class)', () => {
    expect(scorePassword('password1234')).toBe(2)
  })

  test('mixed case + number at length 8+ scores 3', () => {
    expect(scorePassword('Password1')).toBe(3)
  })

  test('mixed case + number + symbol at length ≥ 12 scores 4', () => {
    expect(scorePassword('Password1$@xyz')).toBe(4)
  })

  test('mixed case + number + symbol at length 8-11 stays at 3 (length cap)', () => {
    // 11-char password with all three diversity classes — the length cap
    // forces it to 3 instead of 4. The UX-DR8 contract: very-strong
    // requires length ≥ 12 even with full character-class diversity.
    expect(scorePassword('Pass1!ABcd2')).toBe(3)
  })

  test('deterministic + idempotent — same input across multiple calls returns the same score', () => {
    const sample = 'Mixed1Case!Plus'
    const first = scorePassword(sample)
    const second = scorePassword(sample)
    const third = scorePassword(sample)
    expect(first).toBe(second)
    expect(second).toBe(third)
    // And no state leaks between distinct inputs.
    expect(scorePassword('abc')).not.toBe(scorePassword(''))
  })
})
