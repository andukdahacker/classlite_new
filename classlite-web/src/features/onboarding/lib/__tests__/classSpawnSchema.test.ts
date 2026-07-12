/**
 * Story 2-3b Task 2.1 — Zod schema builder tests.
 *
 * Contract lock for `useClassSpawnSchema()` — the locale-reactive builder-hook
 * mirroring `useCenterSetupSchema.ts:45-73` verbatim per Amelia-S6 fold.
 *
 * Coverage:
 * - Rune-count invariants on `cohortName` (mirrors 2-3a Amelia-B1 fix — byte
 *   proxy under-counts Vietnamese multi-byte + emoji surrogate pairs).
 * - Padded ISO date discipline on `startDate` — Winston-I4 fold rejects
 *   Safari's non-padded `YYYY-M-D` output.
 * - Empty-string → null transform on `teacherEmail` — Winston-I5 + Story 2.1
 *   `nullableText` lesson.
 * - Array bounds `[1, 20]` per Story 2.2 AC3.
 * - NO `studentEmails` field (Sally-S4 fold — textarea deferred entirely).
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'

import { useClassSpawnSchema } from '@/features/onboarding/lib/classSpawnSchema'

// ATDD red-phase — file does not exist yet; TS2307 is the intended signal.

describe('useClassSpawnSchema — rune-count invariant on cohortName', () => {
  test('single-byte ASCII: 120 chars passes, 121 fails', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const schema = result.current

    const validPayload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'a'.repeat(120),
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(schema.safeParse(validPayload).success).toBe(true)

    const overflowPayload = {
      ...validPayload,
      classes: [{ ...validPayload.classes[0], cohortName: 'a'.repeat(121) }],
    }
    expect(schema.safeParse(overflowPayload).success).toBe(false)
  })

  test('Vietnamese multi-byte: 120 grapheme clusters passes', () => {
    // 'ngữ' is 3 bytes in UTF-8 but 1 grapheme cluster; a `.length` check
    // (byte proxy) would under-count. `Array.from(v).length` is the fix.
    const { result } = renderHook(() => useClassSpawnSchema())
    const vietnameseName = 'ngữ'.repeat(40) // 120 grapheme clusters
    // JS `.length` counts UTF-16 code units — Vietnamese `ữ` (U+1EEF) is BMP,
    // so `.length` matches grapheme count here (both = 120). The point of
    // this test is that `Array.from(v).length` measures the same 120 the
    // server-side `utf8.RuneCountInString` would — the actual assertion
    // is the schema-accepts check below.
    expect(vietnameseName.length).toBeGreaterThanOrEqual(120)

    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: vietnameseName,
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(true)
  })

  test('emoji surrogate pair: 60 emojis (120 UTF-16 code units) passes rune count', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const emojiName = '🎓'.repeat(60) // 120 UTF-16 code units, 60 grapheme clusters
    expect(emojiName.length).toBeGreaterThanOrEqual(120)

    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: emojiName,
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(true)
  })

  test('empty cohortName after trim rejected', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: '   ',
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })
})

describe('useClassSpawnSchema — padded ISO date discipline (Winston-I4)', () => {
  test.each([
    ['2026-07-15', true, 'canonical padded'],
    ['2026-7-15', false, 'non-padded month (Safari)'],
    ['2026-07-1', false, 'non-padded day'],
    ['2026/07/15', false, 'wrong separator'],
    ['15-07-2026', false, 'wrong order'],
    ['not-a-date', false, 'not a date'],
    ['', false, 'empty string'],
  ])('startDate %s → valid=%s (%s)', (input, expected) => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: input,
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(expected)
  })

  test('rejects startDate more than 30 days in the past', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    // Use fixed past date well beyond 30-day window
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2025-01-01',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })

  // R1-C3-P11 — pin the +5-year future bound added in Chunk 2 (Chunk-2-P10).
  // Symmetric to the past-bound test above; without both, a regression
  // that let 9999-12-31 through would ship silently.
  test('accepts startDate at exactly (nowYear + 5) year boundary', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const nowYear = new Date().getUTCFullYear()
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: `${nowYear + 5}-01-01`,
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(true)
  })

  test('rejects startDate more than 5 years in the future', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const nowYear = new Date().getUTCFullYear()
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: `${nowYear + 6}-01-01`,
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })
})

describe('useClassSpawnSchema — teacherEmail empty→null transform (Winston-I5)', () => {
  test('empty string transforms to null and passes nullable pipe', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: '',
        },
      ],
    }
    const parsed = result.current.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.classes[0].teacherEmail).toBeNull()
    }
  })

  test('whitespace-only transforms to null', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: '   ',
        },
      ],
    }
    const parsed = result.current.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.classes[0].teacherEmail).toBeNull()
    }
  })

  test('valid email is trimmed but preserved', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: '  bob@example.com  ',
        },
      ],
    }
    const parsed = result.current.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      expect(parsed.data.classes[0].teacherEmail).toBe('bob@example.com')
    }
  })

  test('malformed email rejected', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: 'not-an-email',
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })
})

describe('useClassSpawnSchema — classes array bounds', () => {
  test('empty classes array rejected (min 1)', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })

  test('20 classes accepted (max 20 per Story 2.2 AC3)', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: Array.from({ length: 20 }, (_, i) => ({
        cohortName: `Class ${i + 1}`,
        startDate: '2026-07-15',
        teacherEmail: null,
      })),
    }
    expect(result.current.safeParse(payload).success).toBe(true)
  })

  test('21 classes rejected (over max)', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: Array.from({ length: 21 }, (_, i) => ({
        cohortName: `Class ${i + 1}`,
        startDate: '2026-07-15',
        teacherEmail: null,
      })),
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })
})

describe('useClassSpawnSchema — Sally-S4 fold: NO studentEmails field', () => {
  test('extra studentEmails field is stripped (v1 does not accept)', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: '11111111-2222-3333-4444-555555555501',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: null,
          studentEmails: ['s1@example.com', 's2@example.com'],
        },
      ],
    }
    const parsed = result.current.safeParse(payload)
    expect(parsed.success).toBe(true)
    if (parsed.success) {
      // Zod default strips unknown keys; studentEmails must NOT appear
      expect(
        (parsed.data.classes[0] as { studentEmails?: unknown }).studentEmails,
      ).toBeUndefined()
    }
  })
})

describe('useClassSpawnSchema — templateId nullable (Build from scratch)', () => {
  test('templateId: null accepted (Build from scratch path)', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: null,
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(true)
  })

  test('templateId: non-UUID string rejected', () => {
    const { result } = renderHook(() => useClassSpawnSchema())
    const payload = {
      templateId: 'not-a-uuid',
      classes: [
        {
          cohortName: 'Class 1',
          startDate: '2026-07-15',
          teacherEmail: null,
        },
      ],
    }
    expect(result.current.safeParse(payload).success).toBe(false)
  })
})
