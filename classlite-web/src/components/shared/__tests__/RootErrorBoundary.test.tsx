/**
 * AC6 — RootErrorBoundary smoke contract.
 *
 * A child component that throws on render must surface the i18n
 * `app.errorFallback` string inside a role="alert" container. Sentry's
 * captureException must fire with the component stack.
 */
import { describe, expect, test, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { RootErrorBoundary } from '@/components/shared/RootErrorBoundary'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import '@/lib/i18n'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  captureException: mocks.captureException,
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
  browserTracingIntegration: vi.fn(),
  httpClientIntegration: vi.fn(),
}))

function Boom(): never {
  throw new Error('boom from child')
}

describe('RootErrorBoundary', () => {
  test('renders role="alert" fallback when a child throws', () => {
    // Suppress React's expected error logging from the thrown child.
    const consoleErrorSpy = vi
      .spyOn(console, 'error')
      .mockImplementation(() => {})
    try {
      render(
        <RootErrorBoundary>
          <Boom />
        </RootErrorBoundary>,
      )
      const alert = screen.getByRole('alert')
      expect(alert).toBeDefined()
      expect(alert.textContent).toMatch(/Something went wrong/)
      expect(mocks.captureException).toHaveBeenCalled()
    } finally {
      consoleErrorSpy.mockRestore()
    }
  })

  test('renders children when no error is thrown', () => {
    render(
      <RootErrorBoundary>
        <div data-testid="child">ok</div>
      </RootErrorBoundary>,
    )
    expect(screen.getByTestId('child')).toBeDefined()
  })

  test('the app.errorFallback i18n key exists in en + vi', () => {
    assertI18nParity(['app.errorFallback'])
  })
})
