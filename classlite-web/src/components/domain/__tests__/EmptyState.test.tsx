/**
 * EmptyState — Story 10.3 AC1. The canonical empty-state leaf is a DUMB
 * presentational component: it never calls `t()` and never reads role, so these
 * tests pass already-resolved literal strings as props (that is the contract —
 * i18n-key resolution + parity live at the call sites and the ratchet). Covers
 * the flat-interface contract, the `tone` chip/headline suppression, the trailing
 * accent, the `live`→role="status" a11y gate, and axe-zero.
 */
import { render, screen } from '@testing-library/react'
import { Inbox } from 'lucide-react'
import { describe, expect, test } from 'vitest'
import { axe } from 'vitest-axe'

import { Button } from '@/components/ui/button'
import { EmptyState } from '../EmptyState'

describe('EmptyState — AC1 contract', () => {
  test('simple: renders chip (with glyph), headline, trailing accent, description, actions', () => {
    render(
      <EmptyState
        data-testid="es"
        icon={<Inbox data-testid="es-glyph" />}
        headline="Nothing"
        headlineAccent="new yet"
        description="Things show up here."
        actions={<Button>Do it</Button>}
      />,
    )
    const root = screen.getByTestId('es')
    expect(root).toBeInTheDocument()
    expect(screen.getByTestId('es-glyph')).toBeInTheDocument()
    // Headline + accent are distinct nodes; the accent is the italic brand span.
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('Nothing new yet')
    const accent = screen.getByText('new yet')
    expect(accent.tagName).toBe('SPAN')
    expect(accent).toHaveClass('italic')
    expect(screen.getByText('Things show up here.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Do it' })).toBeInTheDocument()
  })

  test('default (live unset): renders NO role="status" (a first-paint empty is not announced as arrived)', () => {
    render(<EmptyState data-testid="es" headline="Quiet" />)
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByTestId('es')).toBeInTheDocument()
  })

  test('live: promotes the container to role="status"', () => {
    render(<EmptyState data-testid="es" headline="Quiet" live />)
    expect(screen.getByRole('status')).toHaveAttribute('data-testid', 'es')
  })

  test('simple without icon still renders a bare muted chip (placeholder idiom)', () => {
    const { container } = render(<EmptyState data-testid="es" headline="Hi" />)
    // The chip is the aria-hidden rounded-full span; it renders even with no glyph.
    const chip = container.querySelector('span[aria-hidden="true"].rounded-full')
    expect(chip).not.toBeNull()
  })

  test('guided WITHOUT icon suppresses the chip entirely', () => {
    const { container } = render(
      <EmptyState tone="guided" data-testid="es">
        <div data-testid="rich">rich content</div>
      </EmptyState>,
    )
    const chip = container.querySelector('span[aria-hidden="true"].rounded-full')
    expect(chip).toBeNull()
    expect(screen.getByTestId('rich')).toBeInTheDocument()
  })

  test('guided WITHOUT headline suppresses the headline (no stamped headline-shaped hole)', () => {
    render(
      <EmptyState tone="guided" data-testid="es">
        <p>carried by children</p>
      </EmptyState>,
    )
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    expect(screen.getByText('carried by children')).toBeInTheDocument()
  })

  test('headline without accent renders no trailing accent span', () => {
    render(<EmptyState data-testid="es" headline="No students yet" />)
    const heading = screen.getByRole('heading', { level: 2 })
    expect(heading).toHaveTextContent('No students yet')
    expect(heading.querySelector('span.italic')).toBeNull()
  })

  test('no accessibility violations (simple, actions present)', async () => {
    const { container } = render(
      <EmptyState
        icon={<Inbox aria-hidden="true" />}
        headline="Nothing"
        headlineAccent="new yet"
        description="Things show up here."
        actions={<Button>Do it</Button>}
        live
      />,
    )
    expect(await axe(container)).toHaveNoViolations()
  })

  test('no accessibility violations (guided, children only)', async () => {
    const { container } = render(
      <EmptyState tone="guided" live>
        <p>A ghosted surface.</p>
      </EmptyState>,
    )
    expect(await axe(container)).toHaveNoViolations()
  })
})
