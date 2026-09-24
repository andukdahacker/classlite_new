// ATDD RED-PHASE — Story 8-3b, Task 7 · **P0 blocking-merge** (AC19 + AC17).
// THE top-risk gate (R-A / FR-50): the softened student view must never surface
// a peer/cohort value, "mistake"/"error" copy, or a red/▼ decline signal — even
// if the backend strip regresses. Party-mode (Murat #1) demanded these be
// POSITIVE-CONTROL-PAIRED and VALUE/STYLE scans, not the 8-3a inert-regex trap
// (a lone negative scan is green forever when the backend already stripped
// everything — nothing to find). See [[feedback_privacy_strip_test_value_scan_not_key_scan]].
//
// RED signal: the presentational views below don't exist yet
//   • @/features/analytics/components/StudentPerformanceOverview  (renders classAvgBand — teacher only)
//   • @/features/analytics/components/StudentMistakesList          (teacher Mistakes — affectedStudentCount)
//   • @/features/analytics/components/StudentPatternsList          (student softened — coaching, no peer/red)
// → TS2307 / Vitest import failure. Every OTHER symbol is real. No `test.skip()`
// (repo convention: compile/import-fail red — [[reference_atdd_red_convention]]).
// These are PRESENTATIONAL components rendered with a fixture prop (not a fetch),
// so this is a pure render assertion — NOT a useQuery mock (TEST-FE-1 intact).
//
// ── SEAMS the dev must expose to turn these green ──────────────────────────
//   • <StudentPerformanceOverview perf={StudentPerformance} /> — on framing:'teacher'
//     each skillBreakdown row shows classAvgBand at
//     data-testid={`student-perf-classavg-${skill}`}; on framing:'student' that
//     element is ABSENT (queryByTestId === null) and NO cohort value renders.
//   • <StudentMistakesList patterns /> shows affectedStudentCount
//     at data-testid={`student-mistake-affected-${i}`}; the STUDENT surface is
//     <StudentPatternsList patterns /> — NO affected count, NO
//     red, coaching copy from the analytics.myPerformance.* namespace.
//   • A student-framed decline element carries NO danger tone token (assert by
//     class, not hex — 8-2b lesson); the teacher render DOES (positive control).
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { formatBandOrDash } from '@/lib/analytics/formatBand'
import type { components } from '@/lib/api/client'
// RED: these modules do not exist yet — the whole file fails to import.
import { StudentPerformanceOverview } from '@/features/analytics/components/StudentPerformanceOverview'
import { StudentMistakesList } from '@/features/analytics/components/StudentMistakesList'
import { StudentPatternsList } from '@/features/analytics/components/StudentPatternsList'

type StudentPerformance = components['schemas']['StudentPerformance']
type MistakePattern = components['schemas']['MistakePattern']

// A student fixture whose peer fields are DELIBERATELY LEAKED (non-null) even on
// the student framing — the defence-in-depth trap: the FE must NOT render them
// regardless of what the wire carries. A peer=null fixture would be VACUOUS.
const LEAKED_PEER_BAND = 6.0
const LEAKED_AFFECTED = 7

function pattern(overrides: Partial<MistakePattern> = {}): MistakePattern {
  return {
    skillSource: 'writing',
    criterion: 'coherenceCohesion',
    type: 'error',
    instanceCount: 12,
    affectedStudentCount: LEAKED_AFFECTED,
    trend: 'worsening',
    patternSource: 'human_comment',
    questionType: null,
    exampleQuote: 'Your conclusion restates the intro.',
    exampleNote: 'Try a forward-looking final sentence.',
    ...overrides,
  }
}

function studentPerf(framing: 'teacher' | 'student'): StudentPerformance {
  return {
    studentId: 'stu-1',
    studentName: 'Nguyen An',
    framing,
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
      // classAvgBand is LEAKED non-null on BOTH framings on purpose (see above).
      { skill: 'writing', overallBand: 5.5, classAvgBand: LEAKED_PEER_BAND, criteria: [] },
    ],
    bandProgression: [
      { skill: 'writing', points: [{ weekStart: '2026-09-14', avgBand: 5.5, submissionCount: 2 }] },
    ],
    mistakePatterns: { coveredSources: ['writing'], excludedSources: [], patterns: [pattern()] },
  }
}

afterEach(() => {
  // no MSW here — pure presentational render
})

describe('8-3b framing-privacy gate — AC19 (P0 blocking-merge)', () => {
  test('AC19a — teacher Overview SHOWS classAvgBand (positive control)', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={studentPerf('teacher')} />
      </I18nextProvider>,
    )
    // The peer value is present at a named locator for the teacher.
    expect(screen.getByTestId('student-perf-classavg-writing')).toBeInTheDocument()
  })

  test('AC19a — student Overview OMITS the peer value even when the wire LEAKS it (VALUE scan)', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPerformanceOverview perf={studentPerf('student')} />
      </I18nextProvider>,
    )
    // Same locator absent…
    expect(screen.queryByTestId('student-perf-classavg-writing')).not.toBeInTheDocument()
    // …AND the leaked value-string never appears anywhere in the student DOM.
    // NOTE (dev-story): the leaked classAvgBand renders (on the teacher positive
    // control) as the formatted band "6.0" (formatBandOrDash → 1 fixed decimal).
    // `String(6.0)` is the JS-coerced "6", which collides with the legitimately
    // rendered targetBand aspiration ("your goal: 6.5") and contradicts AC7 — so
    // we assert absence of the FORMATTED leaked value "6.0" (AC19's stated
    // "value-strings 6.0/7"), the real defence-in-depth check.
    expect(container.textContent).not.toContain(formatBandOrDash(LEAKED_PEER_BAND)) // "6.0"
  })

  test('AC19a — student Patterns OMITS affectedStudentCount even when LEAKED (VALUE scan)', () => {
    const { container } = render(
      <I18nextProvider i18n={i18n}>
        <StudentPatternsList patterns={studentPerf('student').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    expect(container.textContent).not.toContain(String(LEAKED_AFFECTED)) // "7"
  })

  test('AC19b — the peer/mistake copy regex is LIVE (matches teacher, not student) — PAIRED', () => {
    const peerish = /mistake|error|cohort|average|class avg/i
    const teacher = render(
      <I18nextProvider i18n={i18n}>
        <StudentMistakesList patterns={studentPerf('teacher').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    // Positive control: the matcher CAN fire (teacher copy uses "mistake"/"error").
    expect(teacher.container.textContent).toMatch(peerish)
    teacher.unmount()

    const student = render(
      <I18nextProvider i18n={i18n}>
        <StudentPatternsList patterns={studentPerf('student').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    // The SAME live matcher does NOT fire on the softened student surface.
    expect(student.container.textContent).not.toMatch(peerish)
  })

  test('AC19c — decline signal carries NO danger tone token on the student view (STYLE scan, PAIRED)', () => {
    // `worsening` trend on both surfaces. Teacher may show a danger/attention
    // tone; the student surface must be calm (§6.1:346 — decline muted, never red).
    const teacher = render(
      <I18nextProvider i18n={i18n}>
        <StudentMistakesList patterns={studentPerf('teacher').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    const teacherTrend = teacher.getByTestId('student-mistake-trend-0')
    // Positive control: the danger token CAN appear (teacher worsening signal).
    expect(teacherTrend.className).toMatch(/danger|at-risk|red/)
    teacher.unmount()

    const student = render(
      <I18nextProvider i18n={i18n}>
        <StudentPatternsList patterns={studentPerf('student').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    const studentTrend = student.getByTestId('student-pattern-trend-0')
    expect(studentTrend.className).not.toMatch(/danger|at-risk|red/)
    // And no literal ▼ decline glyph on the student surface.
    expect(student.container.textContent).not.toContain('▼')
  })
})

describe('8-3b softened copy namespace — AC17 (PAIRED)', () => {
  test('AC17 — student copy resolves the coaching namespace, NOT the teacher mistake keys', () => {
    // Positive control: the teacher key exists and resolves (matcher is live).
    expect(i18n.exists('analytics.studentPerformance.mistakes.recurringType')).toBe(true)
    // The softened student namespace is distinct and present in en+vi.
    expect(i18n.exists('analytics.myPerformance.patterns.ownDataNote')).toBe(true)
    const student = render(
      <I18nextProvider i18n={i18n}>
        <StudentPatternsList patterns={studentPerf('student').mistakePatterns.patterns} />
      </I18nextProvider>,
    )
    // The softened render resolves the coaching "own data only" note.
    expect(student.getByText(i18n.t('analytics.myPerformance.patterns.ownDataNote'))).toBeInTheDocument()
  })
})
