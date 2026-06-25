/**
 * AuthCard — 3 tests per Story 1-8 AC1.
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import AuthCard from '@/features/auth/components/AuthCard'

describe('AuthCard (Story 1-8 AC1)', () => {
  test('renders all three children slots (heading + body + footer)', () => {
    render(
      <AuthCard
        regionLabel="Sign in"
        heading={<h1 data-testid="heading">Sign in</h1>}
        body={<div data-testid="body">form goes here</div>}
        footer={<div data-testid="footer">cross-screen link</div>}
      />,
    )
    expect(screen.getByTestId('heading').textContent).toBe('Sign in')
    expect(screen.getByTestId('body').textContent).toBe('form goes here')
    expect(screen.getByTestId('footer').textContent).toBe('cross-screen link')
  })

  test('outer container has role="region" with aria-label from consumer slot', () => {
    render(
      <AuthCard
        regionLabel="Create account"
        heading={<h1>Create account</h1>}
        body={<p>body</p>}
      />,
    )
    const region = screen.getByRole('region', { name: 'Create account' })
    expect(region.tagName).toBe('SECTION')
  })

  test('vitest-axe returns zero violations', async () => {
    const { container } = render(
      <AuthCard
        regionLabel="Sign in"
        heading={<h1>Sign in</h1>}
        body={<p>body</p>}
        footer={<a href="/register">Sign up</a>}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
