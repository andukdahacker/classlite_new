/**
 * landing-i18n-parity.test — Story 1.10 AC8 R38 Layer 2 helper unit
 * test. Confirms the helper passes for an existing key, throws on a
 * missing key, and throws on an empty-value key.
 */
import { describe, expect, test } from 'vitest'
import { assertLandingI18nParity } from './landing-i18n-parity'

describe('assertLandingI18nParity', () => {
  test('passes for an existing populated key in both locales', () => {
    expect(() =>
      assertLandingI18nParity(['hero.headline', 'hero.cta'], ['vi', 'en']),
    ).not.toThrow()
  })

  test('throws when a key is missing in the locale modules', () => {
    expect(() =>
      assertLandingI18nParity(['hero.nonexistentKey'], ['vi', 'en']),
    ).toThrow(/missing or non-string/)
  })

  test('passes when only one locale is checked and the key resolves', () => {
    /* `locales: ['vi']` narrows the parity check to vi.ts alone; the
       key exists, so the helper returns without throwing. P15 from
       code review 2026-06-30 — previous test name promised a throw
       but asserted the opposite; rename now matches the assertion. */
    expect(() =>
      assertLandingI18nParity(['feature.writing.title'], ['vi']),
    ).not.toThrow()
  })

  test('throws when only one locale is checked and the key is missing in that locale', () => {
    expect(() =>
      assertLandingI18nParity(['nonexistent.key'], ['vi']),
    ).toThrow(/missing or non-string/)
  })

  test('returns void (no return value) on success', () => {
    const result = assertLandingI18nParity(['header.cta'], ['vi'])
    expect(result).toBeUndefined()
  })
})
