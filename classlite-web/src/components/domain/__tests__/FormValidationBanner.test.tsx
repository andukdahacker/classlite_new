/**
 * FormValidationBanner — Story 10.4 AC6. Dumb top-of-form summary: role="alert",
 * enumerates the current errors, renders nothing when empty. Covers the contract
 * + axe (en + vi resolved strings pass through unchanged).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import { FormValidationBanner } from '../FormValidationBanner'

describe('FormValidationBanner — AC6 contract', () => {
  test('renders role="alert" with the title and every message enumerated', () => {
    render(
      <FormValidationBanner
        data-testid="banner"
        title="Please fix 2 field(s) before continuing:"
        messages={['Class name is required.', 'Capacity must be greater than 0.']}
      />,
    )
    const banner = screen.getByTestId('banner')
    expect(banner).toHaveAttribute('role', 'alert')
    expect(banner).toHaveTextContent('Please fix 2 field(s) before continuing:')
    expect(screen.getByText('Class name is required.')).toBeInTheDocument()
    expect(screen.getByText('Capacity must be greater than 0.')).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
  })

  test('renders NOTHING when there are no messages', () => {
    const { container } = render(<FormValidationBanner title="x" messages={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  test('no accessibility violations (en)', async () => {
    const { container } = render(
      <FormValidationBanner
        title={i18n.t('classes.form.validationBanner.title', { count: 1 })}
        messages={[i18n.t('classes.form.errors.nameRequired')]}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations (vi)', async () => {
    await i18n.changeLanguage('vi')
    const { container } = render(
      <FormValidationBanner
        title={i18n.t('classes.form.validationBanner.title', { count: 1 })}
        messages={[i18n.t('classes.form.errors.nameConflict')]}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
    await i18n.changeLanguage('en')
  })
})
