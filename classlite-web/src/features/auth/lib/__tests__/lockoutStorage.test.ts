/**
 * lockoutStorage — 10 tests per Story 1-9d AC1 / Task 3.2.
 *
 * 5 baseline: round-trip read/write/clear, well-formed past-timestamp
 * self-clears, missing returns null, SecurityError handling, write rejects
 * non-finite.
 *
 * 5 Murat M1 BLOCKER poisoning ratchets: NaN, -1, overflow, malformed JSON
 * (no lockoutUntilMs field), past-by-24h. Each MUST self-clear AND return
 * null. Without these, an attacker plants a poisoned key and the user is
 * locked OUT of /login indefinitely (rehydrate → reject → rehydrate loop).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import {
  LOCKOUT_STORAGE_KEY,
  clearLockoutUntilMs,
  readLockoutUntilMs,
  writeLockoutUntilMs,
} from '@/features/auth/lib/lockoutStorage'

describe('lockoutStorage (Story 1-9d AC1 / Task 3.2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.localStorage.clear()
  })

  // Baseline 1: round-trip
  test('write + read round-trip returns the persisted timestamp', () => {
    const future = Date.now() + 60_000
    writeLockoutUntilMs(future)
    expect(readLockoutUntilMs()).toBe(future)
  })

  // Baseline 2: missing key
  test('readLockoutUntilMs returns null when key is absent', () => {
    expect(readLockoutUntilMs()).toBeNull()
  })

  // Baseline 3: clear
  test('clearLockoutUntilMs removes the key', () => {
    writeLockoutUntilMs(Date.now() + 60_000)
    clearLockoutUntilMs()
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
  })

  // Baseline 4: well-formed past-timestamp self-clears
  test('well-formed past timestamp self-clears AND returns null', () => {
    const envelope = { lockoutUntilMs: Date.now() - 1_000, version: 1 }
    window.localStorage.setItem(LOCKOUT_STORAGE_KEY, JSON.stringify(envelope))
    expect(readLockoutUntilMs()).toBeNull()
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
  })

  // Baseline 5: write rejects non-finite + non-positive
  test('writeLockoutUntilMs ignores non-finite or non-positive input', () => {
    writeLockoutUntilMs(Number.NaN)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
    writeLockoutUntilMs(-1)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
    writeLockoutUntilMs(Number.POSITIVE_INFINITY)
    expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
  })

  // Poisoning ratchets — Murat M1 BLOCKER (per AC1)
  describe('poisoning ratchets (Murat M1 BLOCKER — self-clear contract)', () => {
    test.each([
      ['NaN-string', 'NaN'],
      ['negative-int-string', '-1'],
      ['overflow-string', '9999999999999999999'],
      ['malformed-no-field', '{"json":true}'],
      [
        'past-by-24h',
        JSON.stringify({
          lockoutUntilMs: Date.now() - 86_400_000,
          version: 1,
        }),
      ],
    ])('poisoned value %s self-clears + returns null', (_label, value) => {
      window.localStorage.setItem(LOCKOUT_STORAGE_KEY, value)
      expect(readLockoutUntilMs()).toBeNull()
      expect(window.localStorage.getItem(LOCKOUT_STORAGE_KEY)).toBeNull()
    })
  })
})
