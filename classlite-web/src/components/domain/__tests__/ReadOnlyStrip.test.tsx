/**
 * ReadOnlyStrip — Story 10.4 AC7 (s66). Dumb locked-state leaf: indicator +
 * three-part explainer + an action slot; never calls t()/reads role. Covers the
 * contract + axe (en + vi resolved strings pass through unchanged).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ReadOnlyStrip } from '../ReadOnlyStrip'

describe('ReadOnlyStrip — AC7 contract', () => {
  test('renders the indicator, the what/why body, and the action', () => {
    render(
      <ReadOnlyStrip
        data-testid="strip"
        indicator="Locked"
        title="This exercise is locked"
        body="It has student submissions. Clone it to make an editable copy."
        action={<Button>Clone</Button>}
      />,
    )
    expect(screen.getByTestId('strip')).toBeInTheDocument()
    expect(screen.getByText('Locked')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'This exercise is locked' })).toBeInTheDocument()
    expect(
      screen.getByText('It has student submissions. Clone it to make an editable copy.'),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Clone' })).toBeInTheDocument()
  })

  test('it is an informational state, not an alert (no role="alert")', () => {
    render(<ReadOnlyStrip data-testid="strip" indicator="Locked" title="t" body="b" />)
    expect(screen.getByTestId('strip')).not.toHaveAttribute('role', 'alert')
  })

  test('no accessibility violations (en)', async () => {
    const { container } = render(
      <ReadOnlyStrip
        indicator={i18n.t('exercises.locked.indicator')}
        title={i18n.t('exercises.locked.strip.title')}
        body={i18n.t('exercises.locked.strip.body')}
        action={<Button>{i18n.t('exercises.locked.clone.cta')}</Button>}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations (vi)', async () => {
    await i18n.changeLanguage('vi')
    const { container } = render(
      <ReadOnlyStrip
        indicator={i18n.t('exercises.locked.indicator')}
        title={i18n.t('exercises.locked.strip.title')}
        body={i18n.t('exercises.locked.strip.body')}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
    await i18n.changeLanguage('en')
  })
})
