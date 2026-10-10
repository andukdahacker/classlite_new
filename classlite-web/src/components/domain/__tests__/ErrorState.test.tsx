/**
 * ErrorState — Story 10.4 AC1. The canonical inline error-state leaf is a DUMB
 * presentational component: it never calls `t()` and never reads role, so these
 * tests pass already-resolved literal strings as props (that is the contract —
 * i18n-key resolution + parity live at the call sites and the ratchet). Covers
 * the flat-interface contract, the three-part message/detail/retry+action
 * mapping, the retry gating (both label AND handler), role="alert", and axe-zero
 * (en + vi).
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AlertTriangle } from 'lucide-react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { axe } from 'vitest-axe'

import i18n from '@/lib/i18n'
import { Button } from '@/components/ui/button'
import { ErrorState } from '../ErrorState'

afterEach(async () => {
  await i18n.changeLanguage('en')
})

describe('ErrorState — AC1 contract', () => {
  test('renders role="alert" with the required message', () => {
    render(<ErrorState data-testid="es" message="Something broke." />)
    const root = screen.getByTestId('es')
    expect(root).toBeInTheDocument()
    expect(root).toHaveAttribute('role', 'alert')
    expect(screen.getByText('Something broke.')).toBeInTheDocument()
  })

  test('three-part: renders detail (the "why") when supplied', () => {
    render(
      <ErrorState data-testid="es" message="Storage full" detail="You are at your plan limit." />,
    )
    expect(screen.getByText('Storage full')).toBeInTheDocument()
    expect(screen.getByText('You are at your plan limit.')).toBeInTheDocument()
  })

  test('renders a retry Button and wires onRetry when BOTH retryLabel and onRetry are supplied', async () => {
    const onRetry = vi.fn()
    render(<ErrorState message="Boom" retryLabel="Try again" onRetry={onRetry} />)
    const button = screen.getByRole('button', { name: 'Try again' })
    expect(button).toBeInTheDocument()
    await userEvent.click(button)
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  test('renders NO retry Button when onRetry is absent (label alone is inert)', () => {
    render(<ErrorState message="Boom" retryLabel="Try again" />)
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  test('renders NO retry Button when retryLabel is absent (handler alone has nothing to label)', () => {
    render(<ErrorState message="Boom" onRetry={() => {}} />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('renders the "what to do next" action slot (an alternate recovery path, no retry)', () => {
    render(
      <ErrorState
        message="Storage full"
        action={<Button variant="outline">View storage</Button>}
      />,
    )
    expect(screen.getByRole('button', { name: 'View storage' })).toBeInTheDocument()
  })

  test('renders the ghosted icon aria-hidden (decorative, not announced)', () => {
    const { container } = render(
      <ErrorState message="Boom" icon={<AlertTriangle data-testid="es-glyph" />} />,
    )
    expect(screen.getByTestId('es-glyph')).toBeInTheDocument()
    expect(container.querySelector('span[aria-hidden="true"]')).not.toBeNull()
  })

  test('no accessibility violations (en — message + detail + retry + action)', async () => {
    const { container } = render(
      <ErrorState
        icon={<AlertTriangle aria-hidden="true" />}
        message="We couldn't load that."
        detail="The server returned an error."
        retryLabel="Try again"
        onRetry={() => {}}
        action={<Button variant="outline">Go to Dashboard</Button>}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations (vi locale render)', async () => {
    await i18n.changeLanguage('vi')
    const { container } = render(
      <ErrorState
        message={i18n.t('dashboard.teacher.errorMessage')}
        retryLabel={i18n.t('dashboard.teacher.retry')}
        onRetry={() => {}}
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
