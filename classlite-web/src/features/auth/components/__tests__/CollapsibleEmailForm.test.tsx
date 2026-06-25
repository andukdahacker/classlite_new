/**
 * CollapsibleEmailForm — 4 tests per Story 1-8 AC1.
 */
import { useState } from 'react'
import { describe, expect, test } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import CollapsibleEmailForm from '@/features/auth/components/CollapsibleEmailForm'

function Wrapper({ initial = false }: { initial?: boolean }) {
  const [open, setOpen] = useState(initial)
  return (
    <CollapsibleEmailForm
      open={open}
      onOpenChange={setOpen}
      triggerLabel="Sign in with email"
    >
      <input data-testid="inside-field" aria-label="Email" />
    </CollapsibleEmailForm>
  )
}

describe('CollapsibleEmailForm (Story 1-8 AC1)', () => {
  test('starts collapsed when initial open is false', () => {
    render(<Wrapper initial={false} />)
    // Base UI Collapsible.Panel unmounts when closed; the trigger
    // remains and `aria-expanded` is the contract. Child content is
    // absent from the DOM.
    expect(
      screen
        .getByTestId('collapsible-email-trigger')
        .getAttribute('aria-expanded'),
    ).toBe('false')
    expect(screen.queryByTestId('inside-field')).toBeNull()
  })

  test('clicking the trigger expands and reveals child content', async () => {
    const user = userEvent.setup()
    render(<Wrapper initial={false} />)
    await user.click(screen.getByTestId('collapsible-email-trigger'))
    expect(
      screen
        .getByTestId('collapsible-email-trigger')
        .getAttribute('aria-expanded'),
    ).toBe('true')
    expect(screen.getByTestId('inside-field')).toBeTruthy()
  })

  test('controlled open prop force-expands from a parent state change', async () => {
    function Controlled() {
      const [open, setOpen] = useState(false)
      return (
        <>
          <button
            type="button"
            data-testid="force-open"
            onClick={() => setOpen(true)}
          >
            force
          </button>
          <CollapsibleEmailForm
            open={open}
            onOpenChange={setOpen}
            triggerLabel="Trigger"
          >
            <span data-testid="payload">inside</span>
          </CollapsibleEmailForm>
        </>
      )
    }
    const user = userEvent.setup()
    render(<Controlled />)
    expect(screen.queryByTestId('payload')).toBeNull()
    await user.click(screen.getByTestId('force-open'))
    expect(screen.getByTestId('payload')).toBeTruthy()
  })

  test('vitest-axe returns zero violations on both states', async () => {
    const { container, rerender } = render(<Wrapper initial={false} />)
    expect(await axe(container)).toHaveNoViolations()
    rerender(<Wrapper initial={true} />)
    expect(await axe(container)).toHaveNoViolations()
  })
})
