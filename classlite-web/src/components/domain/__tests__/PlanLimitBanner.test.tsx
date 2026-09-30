// Story 9-1b — C12 (P1) / AC12 / D-9-1b-2. The per-class usage banner ships
// LIVE now with the THREAT language stripped: calm factual "N of M students",
// a neutral split suggestion, dismissible — and crucially NO "limit" /
// "approaching" / "upgrade" language (that escalation is 9.2, when the wall
// bites). The negative assertions ARE the point of this test.
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { afterEach, describe, expect, test } from 'vitest'
import i18n from '@/lib/i18n'
import { PlanLimitBanner } from '@/components/domain/PlanLimitBanner'

function renderBanner(current: number, max: number): void {
  render(
    <I18nextProvider i18n={i18n}>
      <PlanLimitBanner current={current} max={max} />
    </I18nextProvider>,
  )
}

afterEach(() => cleanup())

describe('PlanLimitBanner — calm factual usage (AC12/D-9-1b-2)', () => {
  test('renders the present-tense count and a neutral split suggestion', () => {
    renderBanner(18, 20)
    expect(
      screen.getByText(i18n.t('billing.banner.studentCount', { current: 18, max: 20 })),
    ).toBeInTheDocument()
    expect(
      screen.getByText(i18n.t('billing.banner.splitSuggestion')),
    ).toBeInTheDocument()
  })

  test('carries NO threat / upgrade language (the D-9-1b-2 contract)', () => {
    renderBanner(18, 20)
    const banner = screen.getByTestId('plan-limit-banner')
    expect(banner.textContent ?? '').not.toMatch(/limit|approaching|upgrade/i)
    expect(screen.queryByRole('button', { name: /upgrade/i })).not.toBeInTheDocument()
  })

  test('is dismissible — dismiss removes it from the DOM', () => {
    renderBanner(18, 20)
    fireEvent.click(screen.getByRole('button', { name: i18n.t('billing.banner.dismiss') }))
    expect(screen.queryByTestId('plan-limit-banner')).not.toBeInTheDocument()
  })
})
