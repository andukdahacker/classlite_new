/**
 * InlineFieldError — Story 10.4 AC6. Dumb per-field error leaf: role="alert",
 * red text, i18n-resolved message. Covers the contract + axe (the message arrives
 * resolved, so there is no locale branch in the component itself).
 */
import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import { InlineFieldError } from '../InlineFieldError'

describe('InlineFieldError — AC6 contract', () => {
  test('renders role="alert" with the resolved message', () => {
    render(<InlineFieldError message="Class name is required." data-testid="fe" />)
    const node = screen.getByTestId('fe')
    expect(node).toHaveAttribute('role', 'alert')
    expect(node).toHaveTextContent('Class name is required.')
  })

  test('no accessibility violations', async () => {
    const { container } = render(
      <InlineFieldError message="A class with this name already exists." />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
