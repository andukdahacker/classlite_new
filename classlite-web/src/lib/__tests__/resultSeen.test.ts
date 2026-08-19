// Story 5.5b Task 5b — resultSeen per-device unread ledger (AC15/D-DISCOVERY).
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { isResultUnread, markResultSeen } from '../resultSeen'

beforeEach(() => window.localStorage.clear())
afterEach(() => window.localStorage.clear())

describe('resultSeen', () => {
  test('a released, unseen result is unread; marking it seen clears the unread', () => {
    expect(isResultUnread('a-1', true)).toBe(true)
    markResultSeen('a-1')
    expect(isResultUnread('a-1', true)).toBe(false)
  })

  test('an unreleased result is never unread (only released rows can be unread)', () => {
    expect(isResultUnread('a-2', false)).toBe(false)
  })

  test('gradedAt re-arms unread on a re-grade (a new timestamp is a new key)', () => {
    markResultSeen('a-3', '2026-08-14T00:00:00Z')
    expect(isResultUnread('a-3', true, '2026-08-14T00:00:00Z')).toBe(false)
    // A re-grade bumps gradedAt → the row is unread again.
    expect(isResultUnread('a-3', true, '2026-08-15T00:00:00Z')).toBe(true)
  })

  test('a blank assignmentId is inert (never unread, never throws)', () => {
    expect(isResultUnread('', true)).toBe(false)
    expect(() => markResultSeen('')).not.toThrow()
  })

  test('a throwing localStorage is swallowed → defaults to seen, never throws (SSR/quota-safe)', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('disabled')
    })
    try {
      // A broken store defaults to "seen" (not unread) — no stuck dot; never throws.
      expect(() => isResultUnread('a-4', true)).not.toThrow()
      expect(isResultUnread('a-4', true)).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})
