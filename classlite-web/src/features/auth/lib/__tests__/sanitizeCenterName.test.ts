/**
 * sanitizeCenterName — Story 1-9c AC4 / Task 3.4 (Sally party-mode 2026-06-26).
 *
 * 8 pinned tests covering null / empty / whitespace / happy ASCII / happy
 * Vietnamese diacritics / HTML-tag injection / emoji / control-char / >60
 * chars. The regex is conservative — Story 7-1 owns the broader character
 * class if real staff-invite delivery surfaces names that include `&` or
 * parentheses.
 */
import { describe, expect, test } from 'vitest'
import { sanitizeCenterName } from '@/features/auth/lib/sanitizeCenterName'

describe('sanitizeCenterName (Story 1-9c AC4)', () => {
  test('returns null for null input', () => {
    expect(sanitizeCenterName(null)).toBeNull()
  })

  test('returns null for empty string', () => {
    expect(sanitizeCenterName('')).toBeNull()
  })

  test('returns null for whitespace-only string', () => {
    expect(sanitizeCenterName('   ')).toBeNull()
    expect(sanitizeCenterName('\t\n  ')).toBeNull()
  })

  test('returns the normalized name for happy ASCII (IELTS Academy)', () => {
    expect(sanitizeCenterName('IELTS Academy')).toBe('IELTS Academy')
  })

  test('returns the normalized name for happy Vietnamese diacritics', () => {
    expect(sanitizeCenterName('Trung tâm IELTS Hà Nội')).toBe(
      'Trung tâm IELTS Hà Nội',
    )
  })

  test('accepts apostrophe, period, and hyphen', () => {
    expect(sanitizeCenterName("O'Brien's Center")).toBe("O'Brien's Center")
    expect(sanitizeCenterName('Test Inc.')).toBe('Test Inc.')
    expect(sanitizeCenterName('Co-op Center')).toBe('Co-op Center')
  })

  test('rejects HTML-tag injection', () => {
    expect(sanitizeCenterName('<script>alert(1)</script>')).toBeNull()
    expect(sanitizeCenterName('Center <b>X</b>')).toBeNull()
  })

  test('rejects emoji', () => {
    expect(sanitizeCenterName('Cool Center 🎉')).toBeNull()
  })

  test('rejects null-byte and control characters', () => {
    // Use the JavaScript `\u0000` / `\x07` escapes (NOT literal control bytes)
    // so the source file stays valid UTF-8 — embedding a raw NUL byte makes
    // `file(1)` report the source as binary `data` and breaks `git diff`.
    expect(sanitizeCenterName('Center\u0000X')).toBeNull()
    expect(sanitizeCenterName('Center\x07X')).toBeNull()
  })

  test('rejects strings longer than 60 characters', () => {
    const over = 'a'.repeat(61)
    expect(sanitizeCenterName(over)).toBeNull()
    const exact = 'a'.repeat(60)
    expect(sanitizeCenterName(exact)).toBe(exact)
  })

  test('trims surrounding whitespace before checking', () => {
    expect(sanitizeCenterName('  IELTS Academy  ')).toBe('IELTS Academy')
  })
})
