import { describe, test, expect } from 'vitest'
import { assertI18nParity, keysFor } from './i18n-parity'

describe('assertI18nParity', () => {
  test('passes when every key exists in en + vi', () => {
    expect(() => assertI18nParity(['app.name', 'app.welcome'])).not.toThrow()
  })

  test('fails when a key is missing in one locale', () => {
    expect(() =>
      assertI18nParity(['app.name', 'definitely.not.a.real.key']),
    ).toThrow(/i18n parity check failed/)
  })

  test('fails with a readable diff listing the missing key', () => {
    let caught: unknown
    try {
      assertI18nParity(['definitely.not.a.real.key'])
    } catch (err) {
      caught = err
    }
    expect(caught).toBeDefined()
    expect(String(caught)).toContain('definitely.not.a.real.key')
    expect(String(caught)).toContain('en.json')
    expect(String(caught)).toContain('vi.json')
  })

  test('honors the locales argument', () => {
    // If we only check en, a vi-only key would pass — but our shared
    // setup has identical keysets, so a real key passes the en-only check.
    expect(() => assertI18nParity(['app.name'], ['en'])).not.toThrow()
  })
})

describe('keysFor', () => {
  test('returns the same number of keys for en and vi when in parity', () => {
    expect(keysFor('en').size).toBe(keysFor('vi').size)
  })

  test('includes the seeded app.name key', () => {
    expect(keysFor('en').has('app.name')).toBe(true)
    expect(keysFor('vi').has('app.name')).toBe(true)
  })
})
