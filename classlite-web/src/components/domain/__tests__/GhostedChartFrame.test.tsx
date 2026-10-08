/**
 * GhostedChartFrame — Story 10.3 AC2. Presentation-pure ghosted chart frame for
 * s57 / s61. The frame + em-dash placeholders live in an aria-hidden subtree so
 * the empty region's accessible name comes ONLY from the surrounding EmptyState
 * (never "dash dash dash"). Covers that boundary + axe-zero inside an EmptyState.
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import { EmptyState } from '../EmptyState'
import { GhostedChartFrame } from '../GhostedChartFrame'

describe('GhostedChartFrame — AC2', () => {
  test('the whole frame subtree is aria-hidden', () => {
    render(<GhostedChartFrame data-testid="frame" />)
    expect(screen.getByTestId('frame')).toHaveAttribute('aria-hidden', 'true')
  })

  test('the em-dash placeholders live in an aria-hidden subtree (excluded from the accessible name)', () => {
    render(
      <EmptyState tone="guided" live data-testid="region" headline="No classes to analyze yet">
        <GhostedChartFrame data-testid="frame" />
      </EmptyState>,
    )
    const region = screen.getByRole('status')
    // Accessible text comes from the EmptyState headline...
    expect(region).toHaveTextContent('No classes to analyze yet')
    // ...and every dash placeholder sits inside an aria-hidden ancestor, so a
    // screen reader never announces the ghost fill ("dash dash dash"). (A spaced
    // `not.toHaveTextContent('— — — —')` literal could never match the unspaced
    // DOM text and `toHaveTextContent` reads aria-hidden text anyway — so this
    // walks the actual hidden boundary instead.)
    const dashes = screen.getAllByText('—')
    expect(dashes.length).toBeGreaterThan(0)
    for (const dash of dashes) {
      expect(dash.closest('[aria-hidden="true"]')).not.toBeNull()
    }
  })

  test('no accessibility violations inside a guided EmptyState', async () => {
    const { container } = render(
      <EmptyState tone="guided" live headline="No classes to analyze yet">
        <GhostedChartFrame />
      </EmptyState>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
