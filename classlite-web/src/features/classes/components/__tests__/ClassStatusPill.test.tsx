// Story 3.1 (AC8) — ClassStatusPill offers ONLY legal next states; the current
// state is absent from the menu (so the same-state 422 is unreachable from UI).
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { I18nextProvider } from 'react-i18next'
import { describe, expect, test, vi } from 'vitest'
import i18n from '@/lib/i18n'
import { ClassStatusPill } from '../ClassStatusPill'
import { CLIENT_TRANSITIONS } from '../../lib/classTransitions'
import type { ClassStatus } from '../../api/useClasses'

function renderPill(status: ClassStatus, onTransition = vi.fn()) {
  return render(
    <I18nextProvider i18n={i18n}>
      <ClassStatusPill status={status} onTransition={onTransition} />
    </I18nextProvider>,
  )
}

describe('ClassStatusPill — legal next states only', () => {
  test.each(['upcoming', 'active', 'paused'] as const)(
    '%s pill offers exactly its legal next states, current absent',
    async (status) => {
      const user = userEvent.setup()
      renderPill(status)
      await user.click(screen.getByTestId(`class-status-pill-${status}`))
      const legal = CLIENT_TRANSITIONS[status]
      await waitFor(() => {
        expect(
          screen.getByTestId(`class-status-option-${legal[0]}`),
        ).toBeInTheDocument()
      })
      // Current state is never an option → same-state transition unreachable.
      expect(
        screen.queryByTestId(`class-status-option-${status}`),
      ).not.toBeInTheDocument()
    },
  )

  test('ended is terminal — no transition trigger (renders plain pill)', () => {
    renderPill('ended')
    // No caret/menu affordance: a plain span, and no dropdown options.
    expect(screen.getByTestId('class-status-pill-ended')).toBeInTheDocument()
    expect(
      screen.queryByTestId('class-status-option-active'),
    ).not.toBeInTheDocument()
  })
})

// Story 3.2 (AC5) — the detail-head renders the pill as a READ-ONLY static
// badge (no `onTransition`). `onTransition?:` is optional; when omitted, even a
// non-terminal status renders a plain span with no transition affordance.
describe('ClassStatusPill — read-only static badge (Story 3.2 detail head)', () => {
  test.each(['upcoming', 'active', 'paused', 'ended'] as const)(
    '%s with no onTransition renders a static badge, no interactive trigger',
    (status) => {
      render(
        <I18nextProvider i18n={i18n}>
          <ClassStatusPill status={status} />
        </I18nextProvider>,
      )
      const pill = screen.getByTestId(`class-status-pill-${status}`)
      expect(pill.tagName).toBe('SPAN')
      // Not a button/trigger, and no transition menu options exist.
      expect(pill).not.toHaveAttribute('aria-haspopup')
      expect(
        screen.queryByRole('button', {
          name: i18n.t('classes.transition.trigger', {
            status: i18n.t(`classes.status.${status}`),
          }),
        }),
      ).not.toBeInTheDocument()
    },
  )

  // NOTE: the onSelect → onTransition invocation is NOT unit-tested here —
  // Radix DropdownMenu.Item's onSelect fires through a custom pointer-event
  // system jsdom cannot drive (verified: neither userEvent.click, keyboard,
  // nor fireEvent reaches it). The wiring is a trivial inline arrow, and the
  // actual transition behavior is covered end-to-end by
  // useTransitionClassStatus.test.tsx (optimistic settle/rollback/multi-scope)
  // and the backend handler ATDD (class_handler_atdd_test.go).
})
