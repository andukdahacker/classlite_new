// ATDD RED-PHASE — Story 8-2b, Task 8 (i18n parity, AC21 / TEST-FE-4 / UX-2).
// Every new `analytics.*` string exists in BOTH en.json AND vi.json (co-primary),
// and the story REUSES the existing scopeBar.* / people.student.* /
// dashboard.atRisk.reason.* keys rather than duplicating.
//
// RED nature: RUNTIME-red, not TS2307 — `assertI18nParity` + the locale JSON are
// real, so this file compiles; it FAILS until the dev adds the `analytics.*`
// block to both locales (the keys below do not exist yet). Also append a
// STORY_8_2B_KEYS block to i18n-parity-coverage.test.ts (the master ratchet).
// [[reference_atdd_red_convention]] — no `test.skip()`.
//
// ── SEAMS ──────────────────────────────────────────────────────────────────
//   Add these keys to src/locales/en.json AND src/locales/vi.json (Task 8).
import { describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { assertI18nParity } from '@/lib/test/i18n-parity'
// The key lists live in a plain (non-`.test`) module so the master ratchet can
// import them without re-executing this suite (code-review 2026-09-22).
import {
  STORY_8_2B_KEYS,
  STORY_8_2B_REUSED_KEYS,
} from './analyticsI18nKeys'

describe('analytics i18n parity (AC21)', () => {
  test('every new analytics.* key exists in en AND vi', () => {
    assertI18nParity(STORY_8_2B_KEYS)
  })

  test('reused scopeBar / people / at-risk-reason keys resolve in both locales (no duplication)', () => {
    assertI18nParity(STORY_8_2B_REUSED_KEYS)
  })

  test('the "—" placeholder is a resolved i18n key, never a hardcoded dash', () => {
    expect(i18n.exists('analytics.placeholder.dash')).toBe(true)
  })
})
