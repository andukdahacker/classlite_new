/**
 * SampleDashboardPreview — Story 2-4 Task 5.4 inline tests.
 *
 * TEST-FE-2 N/A per M-INFO-20: fixture-driven, no fetch state.
 */
import { render, screen, within } from '@testing-library/react'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test } from 'vitest'

import SampleDashboardPreview from '@/features/dashboard/SampleDashboardPreview'
import i18n from '@/lib/i18n'
import {
  sampleOwnerPreview,
  OWNER_PREVIEW_PLACEHOLDER,
} from '@/features/dashboard/lib/sampleOwnerPreview'

function renderCard() {
  return render(
    <I18nextProvider i18n={i18n}>
      <SampleDashboardPreview />
    </I18nextProvider>,
  )
}

describe('SampleDashboardPreview — AC8 ghosted 4-tile strip', () => {
  test('renders the AC8 root testid', () => {
    renderCard()
    expect(screen.getByTestId('dashboard-sample-preview')).toBeInTheDocument()
  })

  test('renders the threshold banner copy', () => {
    renderCard()
    expect(
      screen.getByText(
        i18n.t('dashboard.samplePreview.thresholdBanner') as string,
      ),
    ).toBeInTheDocument()
  })

  test('renders one em-dash value per tile', () => {
    renderCard()
    const dashes = screen.getAllByText(OWNER_PREVIEW_PLACEHOLDER)
    expect(dashes).toHaveLength(sampleOwnerPreview.length)
  })

  test('renders each tile label from the fixture', () => {
    renderCard()
    for (const tile of sampleOwnerPreview) {
      expect(
        screen.getByText(i18n.t(tile.labelKey) as string),
      ).toBeInTheDocument()
    }
  })

  test('renders the AC8 disclaimer', () => {
    const { container } = renderCard()
    // Scope to the last <p> — the threshold banner is also a <p>, so a
    // top-level getByText would match either. Assert both bands render.
    expect(container.textContent).toContain(
      i18n.t('dashboard.samplePreview.disclaimer') as string,
    )
    const section = screen.getByTestId('dashboard-sample-preview')
    expect(
      within(section).getByText(
        i18n.t('dashboard.samplePreview.disclaimer') as string,
      ),
    ).toBeInTheDocument()
  })
})
