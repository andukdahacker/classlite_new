/**
 * ErrorBoundary — polished render-time error fallback (Story 1-7c AC3).
 */
import { describe, expect, test, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { axe } from 'vitest-axe'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { assertI18nParity } from '@/lib/test/i18n-parity'
import i18n from '@/lib/i18n'

const mocks = vi.hoisted(() => ({
  captureException: vi.fn(),
}))

vi.mock('@sentry/react', () => ({
  captureException: mocks.captureException,
  addBreadcrumb: vi.fn(),
  init: vi.fn(),
  browserTracingIntegration: vi.fn(),
}))

function Boom(): never {
  throw new Error('boom')
}

function suppressConsoleError(): { restore: () => void } {
  const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
  return { restore: () => spy.mockRestore() }
}

describe('ErrorBoundary', () => {
  test('catches a render-time error and surfaces the localized fallback', () => {
    mocks.captureException.mockReturnValueOnce('event_aaa111')
    const console = suppressConsoleError()
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      const alert = screen.getByRole('alert')
      expect(alert.textContent).toContain(i18n.t('app.errorBoundary.title'))
      expect(alert.textContent).toContain(i18n.t('app.errorBoundary.body'))
      expect(mocks.captureException).toHaveBeenCalledTimes(1)
      const [error, ctx] = mocks.captureException.mock.calls[0]
      expect(error).toBeInstanceOf(Error)
      expect((error as Error).message).toBe('boom')
      expect(ctx).toMatchObject({
        contexts: { react: { componentStack: expect.any(String) } },
      })
    } finally {
      console.restore()
    }
  })

  test('renders the Sentry event ID when captureException returns one', () => {
    mocks.captureException.mockReturnValueOnce('event_bbb222')
    const console = suppressConsoleError()
    try {
      render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      expect(screen.getByTestId('error-event-id').textContent).toBe(
        'event_bbb222',
      )
      expect(
        screen.getByText(
          new RegExp(i18n.t('app.errorBoundary.eventIdLabel'), 'i'),
        ),
      ).toBeDefined()
    } finally {
      console.restore()
    }
  })

  test('clicking retry clears state and re-renders children when they recover', () => {
    mocks.captureException.mockReturnValueOnce('event_ccc333')
    const console = suppressConsoleError()
    try {
      const { rerender } = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      // Fallback present after Boom throws.
      expect(screen.getByRole('alert')).toBeDefined()

      // Producer recovers — swap the throwing child for a non-throwing
      // child. Until retry is clicked, the boundary stays in error state
      // because state.hasError is still true; the render method short-
      // circuits to the fallback regardless of incoming children.
      rerender(
        <ErrorBoundary>
          <div data-testid="recovered">recovered</div>
        </ErrorBoundary>,
      )
      expect(screen.queryByRole('alert')).not.toBeNull()
      expect(screen.queryByTestId('recovered')).toBeNull()

      // Click retry — state.hasError clears, render returns
      // this.props.children which is now the recovered div.
      fireEvent.click(
        screen.getByRole('button', {
          name: i18n.t('app.errorBoundary.retryCta'),
        }),
      )
      expect(screen.queryByRole('alert')).toBeNull()
      expect(screen.getByTestId('recovered')).toBeDefined()
    } finally {
      console.restore()
    }
  })

  test('renders children unchanged when no error is thrown', () => {
    render(
      <ErrorBoundary>
        <div data-testid="ok-child">ok</div>
      </ErrorBoundary>,
    )
    expect(screen.getByTestId('ok-child')).toBeDefined()
    expect(screen.queryByRole('alert')).toBeNull()
  })

  test('all error-boundary i18n keys exist in en + vi', () => {
    assertI18nParity([
      'app.errorBoundary.title',
      'app.errorBoundary.body',
      'app.errorBoundary.eventIdLabel',
      'app.errorBoundary.retryCta',
      'app.errorBoundary.homeLinkCta',
    ])
  })

  test('legacy app.errorFallback key is gone from both locales', () => {
    expect(() => assertI18nParity(['app.errorFallback'])).toThrow(
      /i18n parity check failed/,
    )
  })

  test('passes axe-core audit with zero violations', async () => {
    mocks.captureException.mockReturnValueOnce('event_ddd444')
    const console = suppressConsoleError()
    try {
      const { container } = render(
        <ErrorBoundary>
          <Boom />
        </ErrorBoundary>,
      )
      const results = await axe(container)
      expect(results).toHaveNoViolations()
    } finally {
      console.restore()
    }
  })
})
