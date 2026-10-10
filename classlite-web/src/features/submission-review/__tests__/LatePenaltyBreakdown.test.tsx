/**
 * LatePenaltyBreakdown — Story 10.4 AC4 (s63). The shipped 5.5b component already
 * composes the FR-31 equation + the "why" explainer, framed factually (never red).
 * 10.4 adds the clamp: the DISPLAYED penalty is clamped to the original band so a
 * penalty larger than the band can never render a false equation. These tests pin:
 * the exact FR-31 string, the neutral (non-red) tone, the on-time absence, and the
 * clamped large-penalty re-sum.
 */
import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, test } from 'vitest'

import i18n from '@/lib/i18n'
import type { components } from '@/lib/api/client'
import { LatePenaltyBreakdown } from '../components/LatePenaltyBreakdown'

type Submission = components['schemas']['Submission']

function submission(overrides: Partial<Submission> = {}): Submission {
  return {
    id: 'sub-1',
    centerId: 'c-1',
    assignmentId: 'a-1',
    studentId: 'user-student',
    status: 'graded',
    isLate: false,
    appliedPenalty: 0,
    startedAt: '2026-08-13T00:00:00Z',
    submittedAt: '2026-08-13T12:00:00Z',
    timeBudgetSeconds: null,
    schemaVersion: 1,
    content: { schemaVersion: 1, text: 'essay' },
    createdAt: '2026-08-13T00:00:00Z',
    updatedAt: '2026-08-13T12:00:00Z',
    ...overrides,
  }
}

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('LatePenaltyBreakdown — AC4 (s63)', () => {
  test('renders the exact FR-31 equation string from the server-authoritative numbers', () => {
    render(
      <LatePenaltyBreakdown
        submission={submission({ isLate: true, appliedPenalty: 0.5 })}
        overallBand={6.0}
      />,
    )
    const expected = i18n.t('submissionReview.grade.penaltyBreakdown', {
      original: '6.0',
      penalty: '0.5',
      final: '5.5',
    })
    expect(screen.getByText(expected)).toBeInTheDocument()
    // The "why" explainer is present (the two-part what/why).
    expect(
      screen.getByText(i18n.t('submissionReview.grade.penaltyExplainer')),
    ).toBeInTheDocument()
  })

  test('neutral tone — the block is muted, never the red error idiom', () => {
    render(
      <LatePenaltyBreakdown
        submission={submission({ isLate: true, appliedPenalty: 0.5 })}
        overallBand={6.0}
      />,
    )
    const block = screen.getByTestId('student-grade-penalty')
    expect(block).toHaveAttribute('data-tone', 'muted')
    // A penalty is factual, not an alarm — no red tokens, no role="alert".
    expect(block.className).not.toMatch(/cl-red|cl-tint-red/)
    expect(block).not.toHaveAttribute('role', 'alert')
  })

  test('on-time (appliedPenalty === 0) → renders NOTHING (no phantom "0.0" line)', () => {
    const { container } = render(
      <LatePenaltyBreakdown
        submission={submission({ isLate: false, appliedPenalty: 0 })}
        overallBand={6.0}
      />,
    )
    expect(container).toBeEmptyDOMElement()
    expect(screen.queryByTestId('student-grade-penalty')).not.toBeInTheDocument()
  })

  test('late but appliedPenalty 0 → still ABSENT (gate is isLate AND penalty > 0)', () => {
    const { container } = render(
      <LatePenaltyBreakdown
        submission={submission({ isLate: true, appliedPenalty: 0 })}
        overallBand={6.0}
      />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  test('clamped large penalty — a penalty exceeding the band never renders a false equation', () => {
    // Raw: original 1.0 − penalty 2.0 would show "= 0.0" (false: 1.0 − 2.0 = −1.0).
    // Clamped: the displayed penalty is min(2.0, 1.0) = 1.0, so "1.0 − 1.0 = 0.0" re-sums.
    render(
      <LatePenaltyBreakdown
        submission={submission({ isLate: true, appliedPenalty: 2.0 })}
        overallBand={1.0}
      />,
    )
    const clamped = i18n.t('submissionReview.grade.penaltyBreakdown', {
      original: '1.0',
      penalty: '1.0',
      final: '0.0',
    })
    expect(screen.getByText(clamped)).toBeInTheDocument()
    // The false raw equation (penalty 2.0) must NOT appear.
    const falseEquation = i18n.t('submissionReview.grade.penaltyBreakdown', {
      original: '1.0',
      penalty: '2.0',
      final: '0.0',
    })
    expect(screen.queryByText(falseEquation)).not.toBeInTheDocument()
  })
})
