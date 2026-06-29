/**
 * Banner — 6 tests per Story 1-9d AC5 (Winston 1-9c gate discharge).
 *
 * Locks the variant → (containerStyle + ariaRole) contract. The variant
 * styling is rendered through CSS classes wired to `--cl-status-success` /
 * `--cl-status-warning` / `destructive` tokens — assert via the className
 * substring rather than computed style (jsdom doesn't resolve CSS vars).
 */
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import Banner from '@/features/auth/components/Banner'

describe('Banner (Story 1-9d AC5)', () => {
  test("renders success variant with success tokens for 'invited'", () => {
    render(<Banner variant="invited" message="welcomed" />)
    const node = screen.getByTestId('login-form-banner')
    expect(node.className).toContain('--cl-status-success')
    expect(node.getAttribute('data-variant')).toBe('invited')
    expect(node.textContent).toContain('welcomed')
  })

  test("renders success variant with success tokens for 'reset'", () => {
    render(<Banner variant="reset" message="reset ok" />)
    const node = screen.getByTestId('login-form-banner')
    expect(node.className).toContain('--cl-status-success')
    expect(node.getAttribute('data-variant')).toBe('reset')
  })

  test("renders success variant with success tokens for 'verified'", () => {
    render(<Banner variant="verified" message="verified" />)
    const node = screen.getByTestId('login-form-banner')
    expect(node.className).toContain('--cl-status-success')
    expect(node.getAttribute('data-variant')).toBe('verified')
  })

  test("renders destructive variant with destructive tokens for 'oauth-error'", () => {
    render(
      <Banner
        variant="oauth-error"
        message="oops"
        testId="login-form-error"
      />,
    )
    const node = screen.getByTestId('login-form-error')
    expect(node.className).toContain('destructive')
    expect(node.getAttribute('data-variant')).toBe('oauth-error')
  })

  test("renders warning variant with warning tokens for 'session-expired'", () => {
    render(<Banner variant="session-expired" message="signed out" />)
    const node = screen.getByTestId('login-form-banner')
    expect(node.className).toContain('--cl-status-warning')
    expect(node.getAttribute('data-variant')).toBe('session-expired')
  })

  test("aria role is 'alert' for destructive and warning; 'status' for success", () => {
    // destructive → alert
    const { unmount: unmount1 } = render(
      <Banner variant="oauth-error" message="m" testId="b1" />,
    )
    expect(screen.getByTestId('b1').getAttribute('role')).toBe('alert')
    unmount1()

    // warning → alert
    const { unmount: unmount2 } = render(
      <Banner variant="session-expired" message="m" testId="b2" />,
    )
    expect(screen.getByTestId('b2').getAttribute('role')).toBe('alert')
    unmount2()

    // success → status (one assertion per success variant)
    for (const variant of ['invited', 'reset', 'verified'] as const) {
      const { unmount } = render(
        <Banner variant={variant} message="m" testId={`b-${variant}`} />,
      )
      expect(screen.getByTestId(`b-${variant}`).getAttribute('role')).toBe(
        'status',
      )
      unmount()
    }
  })
})
