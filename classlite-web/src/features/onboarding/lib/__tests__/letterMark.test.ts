/**
 * getInitials — Story 2-3a AC5 + Task 2.4.
 *
 * Extracts the letter-mark preview initials from a center name. Rule per AC5
 * (with Sally-I3 party-mode clarifications):
 *  - Split trimmed name on whitespace tokens.
 *  - Take first up-to-2 tokens.
 *  - From each, extract first grapheme cluster passing `\p{L}` filter.
 *  - Uppercase.
 *  - Single-token name → first 2 characters (branch for `ClassLite` → `CL`).
 *  - Zero tokens or all-whitespace → empty string (page renders border-dashed
 *    placeholder, NOT `??` — Sally-I7 fold).
 *  - Emoji / decorative-symbol clusters that fail `\p{L}` → single `?`
 *    fallback for that slot only.
 *
 * RED phase: `@/features/onboarding/lib/letterMark` doesn't exist yet.
 */
import { describe, expect, test } from 'vitest'
import { getInitials, readableTextColor } from '@/features/onboarding/lib/letterMark'

/* eslint-disable no-restricted-syntax -- hex-color contrast math: raw hex is the
   subject under test (the brand-color palette + the chosen foregrounds). */
/** WCAG 2.x relative-luminance contrast ratio between two #rrggbb colors. */
function contrastRatio(a: string, b: string): number {
  const lum = (hex: string): number => {
    const n = parseInt(hex.slice(1), 16)
    const toLinear = (c: number) => {
      const v = c / 255
      return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
    }
    return (
      0.2126 * toLinear((n >> 16) & 0xff) +
      0.7152 * toLinear((n >> 8) & 0xff) +
      0.0722 * toLinear(n & 0xff)
    )
  }
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

describe('readableTextColor — WCAG-legible foreground on a brand color', () => {
  // The closed brand-color palette (CenterSetupPage BRAND_COLOR_VALUES). The
  // letter-mark chip paints initials on these — every pick MUST clear 4.5:1.
  const BRAND_PALETTE = ['#1e3a8a', '#d97706', '#166534', '#991b1b', '#b45309', '#6b6f7a']

  test.each(BRAND_PALETTE)('%s gets a foreground meeting 4.5:1', (brand) => {
    const fg = readableTextColor(brand)
    expect(contrastRatio(fg, brand)).toBeGreaterThanOrEqual(4.5)
  })

  test('the mid-tone amber default picks dark text, not white', () => {
    expect(readableTextColor('#d97706')).toBe('#0f172a')
  })

  test('a dark brand picks white text', () => {
    expect(readableTextColor('#1e3a8a')).toBe('#ffffff')
  })

  test('malformed input falls back to white (never throws)', () => {
    expect(readableTextColor('not-a-color')).toBe('#ffffff')
    expect(readableTextColor('#abc')).toBeTypeOf('string')
  })
})
/* eslint-enable no-restricted-syntax */

describe('getInitials — AC5 letter-mark initials', () => {
  test('two-token English name → first-letter of each', () => {
    expect(getInitials('Saigon English Center')).toBe('SE')
  })

  test('single-token name → first two characters', () => {
    expect(getInitials('ClassLite')).toBe('CL')
  })

  test('Vietnamese two-token name → first-letter of each (no locale stopword filter)', () => {
    // Sally-I3 accepted `TT` (not `TA`) — algorithm is greedy on first two
    // tokens, no locale-aware stopword filter.
    expect(getInitials('Trung tâm Anh ngữ')).toBe('TT')
  })

  test('empty string → empty string (page renders border-dashed pristine)', () => {
    expect(getInitials('')).toBe('')
  })

  test('whitespace-only → empty string', () => {
    expect(getInitials('   ')).toBe('')
    expect(getInitials('\t\n  ')).toBe('')
  })

  test('leading/trailing whitespace trimmed before tokenization', () => {
    expect(getInitials('  Saigon English  ')).toBe('SE')
  })

  test('single-character single token → that character', () => {
    expect(getInitials('X')).toBe('X')
  })

  test('name with only decorative symbols → empty (all tokens fail \\p{L})', () => {
    // Punctuation-only tokens have no \p{L} grapheme.
    expect(getInitials('!!!')).toBe('')
  })

  test('emoji leading a token → `?` fallback for that slot', () => {
    // Emoji fails \p{L}. Rule: `?` for that one slot.
    expect(getInitials('🎉 Center')).toBe('?C')
  })

  test('accented Vietnamese first letter passes \\p{L} (Ả, Đ)', () => {
    expect(getInitials('Ảnh Đại')).toBe('AD')
  })

  test('three-or-more tokens → only first two consumed', () => {
    expect(getInitials('One Two Three Four')).toBe('OT')
  })

  test('uppercase-input stays uppercase', () => {
    expect(getInitials('IELTS ACADEMY')).toBe('IA')
  })

  // R1-P20: single-token with punctuation between letters yields concatenated
  // letters — the branch iterates each character; punctuation is skipped and
  // the next two `\p{L}` graphemes are taken. Locking this in tests so a
  // future refactor doesn't silently change the output.
  test('single-token with punctuation between letters concatenates letters', () => {
    expect(getInitials('X.Y')).toBe('XY')
    expect(getInitials("D'Art")).toBe('DA')
  })

  // R1-P21: single-token pure-emoji returns empty (multi-token branch would
  // return `?`). Documented asymmetry — single-token empty produces the
  // border-dashed pristine tile per Sally-I7, so empty is intentional.
  test('single-token pure emoji → empty string (pristine tile)', () => {
    expect(getInitials('🎉')).toBe('')
    expect(getInitials('🎉🎉')).toBe('')
  })
})
