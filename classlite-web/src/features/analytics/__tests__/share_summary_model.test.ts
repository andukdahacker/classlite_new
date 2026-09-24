// ATDD RED-PHASE — Story 8-3b, Task 5 · **P0 blocking-merge** (AC14 + AC14a, R-C).
// Share-summary DATA EGRESS. Party-mode (Murat #4): the jsPDF path was FLIPPED to
// window.print() precisely because PDF bytes aren't scannable — so BOTH exports
// (clipboard text + the print layout) must be built from ONE pure model, and the
// R-C own-data-only guarantee is proven on the MODEL, not on rendered output. A
// student summary that leaks a peer/cohort value is an FR-50 violation.
//
// RED signal: neither pure fn exists yet
//   • @/features/analytics/lib/buildShareSummaryModel
//   • @/features/analytics/lib/buildShareSummaryText
// → TS2307 / Vitest import failure. No `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • buildShareSummaryModel(perf: StudentPerformance, locale: string): ShareSummaryModel
//     — emits ONLY the student's own data: studentName, dateRange, overallBand,
//       perSkillBands[], onTimeRate/attendance. It must NOT read classAvgBand,
//       affectedStudentCount, or any cohort/peer field off `perf`.
//   • buildShareSummaryText(model: ShareSummaryModel, locale: string): string
//     — Zalo/WhatsApp-friendly plain text derived SOLELY from the model.
//   The @media print layout ALSO consumes the model (tested at render level in F9).
import { describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
// RED: these pure fns do not exist yet.
import { buildShareSummaryModel } from '@/features/analytics/lib/buildShareSummaryModel'
import { buildShareSummaryText } from '@/features/analytics/lib/buildShareSummaryText'

type StudentPerformance = components['schemas']['StudentPerformance']

const LEAKED_PEER_BAND = 6.0
const LEAKED_AFFECTED = 7

// The student's own bands use values that must SURVIVE into the summary; the
// peer fields are LEAKED non-null and must NOT (the trap — a null peer fixture
// would make the assertion vacuous).
function perf(): StudentPerformance {
  return {
    studentId: 'stu-1',
    studentName: 'Nguyễn An', // Vietnamese diacritics — must survive verbatim.
    framing: 'student',
    classId: 'cls-a',
    targetBand: 6.5,
    submissionStats: {
      submissionRate: { onTimeCount: 8, totalDue: 10, rate: 0.8 },
      totalSubmissionCount: 12,
      gradedSubmissionCount: 9,
      praisePinCount: 4,
      errorPinCount: 6,
      hasData: { bandProgression: true, skillBreakdown: true, mistakePatterns: true, submissionStats: true },
    },
    skillBreakdown: [
      { skill: 'writing', overallBand: 5.5, classAvgBand: LEAKED_PEER_BAND, criteria: [] },
      { skill: 'reading', overallBand: 6.5, classAvgBand: LEAKED_PEER_BAND, criteria: [] },
    ],
    bandProgression: [],
    mistakePatterns: {
      coveredSources: ['writing'],
      excludedSources: [],
      patterns: [
        {
          skillSource: 'writing',
          criterion: 'coherenceCohesion',
          type: 'error',
          instanceCount: 12,
          affectedStudentCount: LEAKED_AFFECTED,
          trend: 'worsening',
          patternSource: 'human_comment',
          questionType: null,
          exampleQuote: null,
          exampleNote: null,
        },
      ],
    },
  }
}

describe('8-3b share-summary egress — AC14 (P0 blocking-merge)', () => {
  test('model carries the student OWN bands (5.5 / 6.5 survive)', () => {
    const model = buildShareSummaryModel(perf(), 'en')
    const json = JSON.stringify(model)
    expect(json).toContain('5.5')
    expect(json).toContain('Nguyễn An')
  })

  test('model omits every peer/cohort field even when the wire LEAKS them', () => {
    const model = buildShareSummaryModel(perf(), 'en')
    const json = JSON.stringify(model)
    // No cohort key survives the model boundary.
    expect(json).not.toMatch(/classAvgBand|affectedStudentCount|cohort/i)
    // The leaked affected-student value (7) must not appear as data. (6.0 is also
    // a legit own band here, so we assert the DISTINCT leaked-only value.)
    expect(json).not.toContain(String(LEAKED_AFFECTED))
  })

  test('AC14 — the clipboard TEXT is derived from the model only, no peer leak', () => {
    const model = buildShareSummaryModel(perf(), 'en')
    const text = buildShareSummaryText(model, 'en')
    expect(text).toMatch(/Nguyễn An/)
    expect(text).not.toMatch(/class average|cohort|affected/i)
    expect(text).not.toContain(String(LEAKED_AFFECTED))
  })

  test('Vietnamese diacritics survive the text builder (vi locale — the jsPDF-flip rationale)', () => {
    const model = buildShareSummaryModel(perf(), 'vi')
    const text = buildShareSummaryText(model, 'vi')
    // window.print() renders vi natively; the text builder must not mangle it.
    expect(text).toContain('Nguyễn An')
  })
})
