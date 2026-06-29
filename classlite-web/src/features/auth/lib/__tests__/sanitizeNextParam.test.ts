/**
 * sanitizeNextParam — Story 1-9d AC4 (R-NEW=15 open-redirect discharge).
 *
 * 17 pinned tests: 6 happy paths + 11 rejection ratchets covering the OWASP
 * CWE-601 cheat-sheet bypass classes (protocol-relative, encoded, back-slash,
 * full URLs, javascript:, triple-slash, whitespace-prefix, encoded tab,
 * space-prefix, double-backslash).
 *
 * Pinned RED at Task 0.2 BEFORE the helper is written (per WF-8 ATDD discipline).
 * Implementation at Task 0.3 flips them GREEN.
 */
import { describe, expect, test } from 'vitest'
import { sanitizeNextParam } from '@/features/auth/lib/sanitizeNextParam'

describe('sanitizeNextParam (Story 1-9d AC4 — R-NEW=15 discharge)', () => {
  // Happy paths
  test('null returns /dashboard fallback', () => {
    expect(sanitizeNextParam(null)).toBe('/dashboard')
  })

  test('empty string returns /dashboard fallback', () => {
    expect(sanitizeNextParam('')).toBe('/dashboard')
  })

  test('happy /dashboard returns /dashboard', () => {
    expect(sanitizeNextParam('/dashboard')).toBe('/dashboard')
  })

  test('happy /classes/42 returns /classes/42', () => {
    expect(sanitizeNextParam('/classes/42')).toBe('/classes/42')
  })

  test('happy /students?page=2 returns /students?page=2', () => {
    expect(sanitizeNextParam('/students?page=2')).toBe('/students?page=2')
  })

  test("malformed encoding ('%E0%A4%A') returns /dashboard fallback", () => {
    expect(sanitizeNextParam('%E0%A4%A')).toBe('/dashboard')
  })

  // OWASP CWE-601 base ratchets
  test('protocol-relative //evil.example.com returns /dashboard', () => {
    expect(sanitizeNextParam('//evil.example.com')).toBe('/dashboard')
  })

  test('protocol-relative encoded %2F%2Fevil.example.com returns /dashboard', () => {
    expect(sanitizeNextParam('%2F%2Fevil.example.com')).toBe('/dashboard')
  })

  test('back-slash protocol-relative /\\evil.example.com returns /dashboard', () => {
    expect(sanitizeNextParam('/\\evil.example.com')).toBe('/dashboard')
  })

  test('https://evil.example.com (full URL) returns /dashboard', () => {
    expect(sanitizeNextParam('https://evil.example.com')).toBe('/dashboard')
  })

  test('http://evil.example.com returns /dashboard', () => {
    expect(sanitizeNextParam('http://evil.example.com')).toBe('/dashboard')
  })

  test('javascript:alert(1) returns /dashboard (does not start with /; reject)', () => {
    expect(sanitizeNextParam('javascript:alert(1)')).toBe('/dashboard')
  })

  // Murat M2 + Amelia A8 cheat-sheet additions
  test('triple-slash ///evil.example.com returns /dashboard', () => {
    expect(sanitizeNextParam('///evil.example.com')).toBe('/dashboard')
  })

  test("whitespace-prefix '\\t//evil.example.com' (literal tab after slash) returns /dashboard", () => {
    expect(sanitizeNextParam('/\t//evil.example.com')).toBe('/dashboard')
  })

  test("encoded tab byte '/%09//evil.example.com' returns /dashboard", () => {
    expect(sanitizeNextParam('/%09//evil.example.com')).toBe('/dashboard')
  })

  test("space-prefix '/ /evil.example.com' returns /dashboard", () => {
    expect(sanitizeNextParam('/ /evil.example.com')).toBe('/dashboard')
  })

  test("double-backslash '\\\\evil.example.com' returns /dashboard", () => {
    expect(sanitizeNextParam('\\\\evil.example.com')).toBe('/dashboard')
  })
})
