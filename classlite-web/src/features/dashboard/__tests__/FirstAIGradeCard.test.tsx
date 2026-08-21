/**
 * FirstAIGradeCard — Story 2-4 AC7 + Story 6.2b (T6, FD8) upgrade to the simulated
 * live-first-run flow: idle CTA → animated ~15–30s analysing → fixture reveal.
 * SIMULATED — no MSW, no enqueue, no credit (the card imports no job hook).
 * `prefers-reduced-motion` collapses the animation to an instant reveal.
 */
import { act, fireEvent, render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import FirstAIGradeCard from '@/features/dashboard/FirstAIGradeCard'
import i18n from '@/lib/i18n'
import { sampleAIGrade } from '@/features/dashboard/lib/sampleAIGrade'

const SIMULATED_ANALYSIS_MS = 18_000

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <FirstAIGradeCard />
    </I18nextProvider>,
  )
}

/** Force `prefers-reduced-motion: reduce` so a run reveals instantly (no timers). */
function useReducedMotion() {
  const original = globalThis.matchMedia
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes('reduced-motion') ? true : query.includes('min-width'),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof globalThis.matchMedia
  return () => {
    globalThis.matchMedia = original
  }
}

describe('FirstAIGradeCard — idle state (before the run)', () => {
  test('renders the card, AI mark, essay excerpt, and the Try-AI-grading CTA', () => {
    const { container } = renderCard()
    expect(screen.getByTestId('dashboard-first-ai-grade-card')).toBeInTheDocument()
    expect(container.querySelector('.ai-mark')?.textContent).toContain(
      i18n.t('dashboard.aiSample.aiMarkLabel'),
    )
    expect(screen.getByText(i18n.t('dashboard.aiSample.essayExcerpt'))).toBeInTheDocument()
    const cta = screen.getByTestId('ai-sample-run')
    expect(cta).toHaveTextContent(i18n.t('dashboard.aiSample.tryCta'))
  })

  test('the grade (band ring + criteria + feedback) is NOT shown until the run', () => {
    const { container } = renderCard()
    expect(container.querySelector('#ai-band-value')).toBeNull()
    expect(screen.queryAllByRole('progressbar')).toHaveLength(0)
    expect(screen.queryByText(i18n.t('dashboard.aiSample.feedbackQuote'))).not.toBeInTheDocument()
  })

  test('does NOT render an exploreCta CTA [S-STRONG-7]', () => {
    renderCard()
    expect(screen.queryByText(/see how grading works/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/explore/i)).not.toBeInTheDocument()
  })
})

describe('FirstAIGradeCard — simulated run (animated path)', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.runOnlyPendingTimers()
    vi.useRealTimers()
  })

  test('CTA → analysing progress (VN string exact), then reveals the fixture grade', () => {
    const { container } = renderCard()
    fireEvent.click(screen.getByTestId('ai-sample-run'))

    // Analysing phase: progress + message, no grade yet.
    expect(screen.getByTestId('ai-sample-analyzing')).toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.aiSample.analyzing'))).toBeInTheDocument()
    expect(container.querySelector('#ai-band-value')).toBeNull()

    // The ~15–30s reveal timer fires (act flushes the state update).
    act(() => {
      vi.advanceTimersByTime(SIMULATED_ANALYSIS_MS)
    })

    expect(screen.getByTestId('ai-sample-revealed')).toBeInTheDocument()
    expect(container.querySelector('#ai-band-value')?.textContent).toBe(
      sampleAIGrade.overallBand.toFixed(1),
    )
    expect(screen.queryByTestId('ai-sample-analyzing')).not.toBeInTheDocument()
  })
})

describe('FirstAIGradeCard — reduced motion (instant reveal, S-INFO-16)', () => {
  let restore: () => void
  beforeEach(() => {
    restore = useReducedMotion()
  })
  afterEach(() => {
    restore()
  })

  test('CTA reveals the grade immediately with no analysing phase', () => {
    const { container } = renderCard()
    fireEvent.click(screen.getByTestId('ai-sample-run'))
    // No animated analysing state under reduced motion.
    expect(screen.queryByTestId('ai-sample-analyzing')).not.toBeInTheDocument()
    expect(screen.getByTestId('ai-sample-revealed')).toBeInTheDocument()
    expect(container.querySelector('#ai-band-value')?.textContent).toBe(
      sampleAIGrade.overallBand.toFixed(1),
    )
  })

  test('the revealed grade renders one progressbar per criterion with aria-valuenow', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('ai-sample-run'))
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(sampleAIGrade.criteria.length)
    for (const c of sampleAIGrade.criteria) {
      const expectedLabel = i18n.t('dashboard.aiSample.criterionAriaLabel', {
        label: c.label,
        band: c.band.toFixed(1),
      })
      const bar = bars.find((b) => b.getAttribute('aria-label') === expectedLabel)
      expect(bar, `no progressbar found for criterion ${c.key}`).not.toBeUndefined()
      expect(bar?.getAttribute('aria-valuenow')).toBe(String(c.band))
    }
  })

  test('the revealed band-ring SVG is role="img" with aria-labelledby wiring [AC16]', () => {
    const { container } = renderCard()
    fireEvent.click(screen.getByTestId('ai-sample-run'))
    const svg = container.querySelector('svg[role="img"]')
    expect(svg).not.toBeNull()
    const labelledBy = svg?.getAttribute('aria-labelledby') ?? ''
    expect(labelledBy).toContain('ai-band-title')
    expect(labelledBy).toContain('ai-band-value')
  })

  test('the revealed state shows the feedback quote and disclaimer', () => {
    renderCard()
    fireEvent.click(screen.getByTestId('ai-sample-run'))
    expect(screen.getByText(i18n.t('dashboard.aiSample.feedbackQuote'))).toBeInTheDocument()
    expect(screen.getByText(i18n.t('dashboard.aiSample.disclaimer'))).toBeInTheDocument()
  })
})
