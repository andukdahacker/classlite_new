// ATDD RED-PHASE — Story 8-2b, Task 2 (single null-vs-0 formatter, D13/R-C).
// AC6/AC10 (P1) — the ONE helper that enforces the "NEVER 0" invariant across
// all 10 nullable contract fields in one place: null → a localized "—" (a
// resolved i18n key, NOT a hardcoded dash), else a LOCALE-CORRECT number.
// Guards the vi decimal bug: band 6.5 must render "6,5" in Vietnamese.
//
// RED signal: `@/lib/analytics/formatBand` does not exist yet (TS2307).
// No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • src/lib/analytics/formatBand.ts:
//       export function formatBandOrDash(value: number | null): string
//       export function formatOrDash(
//         value: number | null, opts?: { style?: 'decimal' | 'percent' },
//       ): string
//     Contract: null → i18n.t('analytics.placeholder.dash') (en "—", vi "—");
//     number → formatted via the i18n/Intl number formatter for i18n.language
//     (vi decimal separator = comma). NEVER returns "0"/"0%" for a null input.
//   • i18n key `analytics.placeholder.dash` added to en.json + vi.json (Task 8).
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('formatBandOrDash — null vs 0 (P1)', () => {
  test('P1 null renders the resolved i18n dash key, NEVER "0"', () => {
    const dash = i18n.t('analytics.placeholder.dash') as string
    expect(formatBandOrDash(null)).toBe(dash)
    expect(formatBandOrDash(null)).not.toBe('0')
    expect(formatBandOrDash(null)).not.toBe('0.0')
  })

  test('P1 a real band renders in en with a dot separator', async () => {
    await i18n.changeLanguage('en')
    expect(formatBandOrDash(6.5)).toBe('6.5')
  })

  test('P1 the vi decimal bug is guarded — 6.5 renders "6,5" in Vietnamese (D13)', async () => {
    await i18n.changeLanguage('vi')
    expect(formatBandOrDash(6.5)).toBe('6,5')
  })

  test('P1 band 0.0 is a REAL score (renders a number), distinct from null→dash', () => {
    const dash = i18n.t('analytics.placeholder.dash') as string
    expect(formatBandOrDash(0)).not.toBe(dash)
  })
})

describe('formatOrDash — percent style (on-time rate, P1)', () => {
  test('P1 a rate fraction renders as a localized percent', () => {
    expect(formatOrDash(0.82, { style: 'percent' })).toBe('82%')
  })

  test('P1 a null rate renders the dash, NEVER "0%" (null ≠ "no assignments due")', () => {
    const dash = i18n.t('analytics.placeholder.dash') as string
    expect(formatOrDash(null, { style: 'percent' })).toBe(dash)
    expect(formatOrDash(null, { style: 'percent' })).not.toBe('0%')
  })
})
