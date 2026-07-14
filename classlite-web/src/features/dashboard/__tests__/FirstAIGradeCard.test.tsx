/**
 * FirstAIGradeCard — Story 2-4 Task 4.4 inline tests.
 *
 * TEST-FE-2 N/A per M-INFO-20: this card is fixture-driven and has no
 * fetch state, so the loading/success/error trilogy does not apply.
 */
import { render, screen } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'

import FirstAIGradeCard from '@/features/dashboard/FirstAIGradeCard'
import i18n from '@/lib/i18n'
import { sampleAIGrade } from '@/features/dashboard/lib/sampleAIGrade'

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <FirstAIGradeCard />
    </I18nextProvider>,
  )
}

describe('FirstAIGradeCard — AC7 static fixture render', () => {
  test('renders the AC7 root testid', () => {
    renderCard()
    expect(
      screen.getByTestId('dashboard-first-ai-grade-card'),
    ).toBeInTheDocument()
  })

  test('renders the AI-mark span with the aiMarkLabel', () => {
    const { container } = renderCard()
    const aiMark = container.querySelector('.ai-mark')
    expect(aiMark).not.toBeNull()
    expect(aiMark?.textContent).toContain(
      i18n.t('dashboard.aiSample.aiMarkLabel') as string,
    )
  })

  test('renders the essay excerpt copy', () => {
    renderCard()
    expect(
      screen.getByText(i18n.t('dashboard.aiSample.essayExcerpt') as string),
    ).toBeInTheDocument()
  })

  test('renders the overall band score with 1 decimal inside the band-ring SVG', () => {
    const { container } = renderCard()
    const bandValue = container.querySelector('#ai-band-value')
    expect(bandValue).not.toBeNull()
    expect(bandValue?.textContent).toBe(sampleAIGrade.overallBand.toFixed(1))
  })

  test('renders one progressbar per criterion with aria-valuenow set', () => {
    renderCard()
    const bars = screen.getAllByRole('progressbar')
    expect(bars).toHaveLength(sampleAIGrade.criteria.length)
    for (const c of sampleAIGrade.criteria) {
      const expectedLabel = i18n.t('dashboard.aiSample.criterionAriaLabel', {
        label: c.label,
        band: c.band.toFixed(1),
      }) as string
      const bar = bars.find(
        (b) => b.getAttribute('aria-label') === expectedLabel,
      )
      expect(bar, `no progressbar found for criterion ${c.key}`).not.toBeUndefined()
      expect(bar?.getAttribute('aria-valuenow')).toBe(String(c.band))
    }
  })

  test('band-ring SVG is role="img" with aria-labelledby wiring [AC16]', () => {
    const { container } = renderCard()
    const svg = container.querySelector('svg[role="img"]')
    expect(svg).not.toBeNull()
    const labelledBy = svg?.getAttribute('aria-labelledby') ?? ''
    expect(labelledBy).toContain('ai-band-title')
    expect(labelledBy).toContain('ai-band-value')
  })

  test('renders the feedback quote and disclaimer', () => {
    renderCard()
    expect(
      screen.getByText(i18n.t('dashboard.aiSample.feedbackQuote') as string),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('dashboard.aiSample.disclaimer') as string),
    ).toBeInTheDocument()
  })

  test('does NOT render an exploreCta CTA [S-STRONG-7]', () => {
    renderCard()
    expect(screen.queryByText(/see how grading works/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/explore/i)).not.toBeInTheDocument()
  })
})
