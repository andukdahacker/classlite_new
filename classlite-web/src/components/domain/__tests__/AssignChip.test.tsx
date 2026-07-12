/**
 * Story 2-3b Task 4.1 — AssignChip component tests (canonical Epic 1D 1d-7 debut).
 *
 * Amelia-B1 fold pre-flight — `AssignChip.tsx` grep-confirmed ABSENT from
 * `src/components/domain/`. Ship Storybook variant + this test file FIRST,
 * then wire into ClassRow (Task 6.2).
 *
 * ACs pinned:
 *  - 3 visual states: empty / assigned / invited
 *  - lockedTo='self' branch renders <div> not <button> (AC8 Solo teacher)
 *  - starIcon prop renders SVG with aria-hidden or wraps Unicode ★
 *    per Sally-I4 discipline
 *  - onOpenComposer callback fires on click (interactive states only)
 *  - onClear callback fires on secondary action
 *  - axe-core zero violations across all states
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { axe } from 'vitest-axe'
import 'vitest-axe/extend-expect'
import { describe, expect, test, vi } from 'vitest'

import { AssignChip } from '@/components/domain/AssignChip'

describe('AssignChip — state=empty', () => {
  test('renders <button> with placeholder text', () => {
    render(
      <AssignChip
        state="empty"
        value={null}
        onOpenComposer={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    const trigger = screen.getByRole('button')
    expect(trigger).toBeInTheDocument()
    expect(trigger).toHaveTextContent(/Assign or invite/i)
  })

  test('click fires onOpenComposer', async () => {
    const onOpenComposer = vi.fn()
    const user = userEvent.setup()
    render(
      <AssignChip
        state="empty"
        value={null}
        onOpenComposer={onOpenComposer}
        onClear={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button'))
    expect(onOpenComposer).toHaveBeenCalledTimes(1)
  })
})

describe('AssignChip — state=assigned', () => {
  test('renders name + role tag; ariaLabel prop overrides default label', () => {
    render(
      <AssignChip
        state="assigned"
        value={{
          userId: 'u1',
          email: 'alice@example.com',
          displayName: 'Alice',
          role: 'Teacher',
        }}
        onOpenComposer={vi.fn()}
        onClear={vi.fn()}
        ariaLabel="Assigned to Alice, Teacher"
      />,
    )
    expect(
      screen.getByRole('button', { name: /Assigned to Alice, Teacher/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/Alice/)).toBeInTheDocument()
    expect(screen.getByText(/Teacher/)).toBeInTheDocument()
  })

  test('starIcon prop renders a decorative star (Sally-I4 aria-hidden)', () => {
    render(
      <AssignChip
        state="assigned"
        value={{
          userId: 'u1',
          email: 'founder@example.com',
          displayName: 'Founder',
          role: 'Founder',
        }}
        starIcon
        onOpenComposer={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    // The star element MUST be aria-hidden (either as SVG with aria-hidden OR
    // as a <span aria-hidden="true">★</span> wrapper per Sally-I4)
    const star = screen.getByTestId('assign-chip-star')
    expect(star).toHaveAttribute('aria-hidden', 'true')
  })
})

describe('AssignChip — state=invited', () => {
  test('renders email + "pending" badge', () => {
    render(
      <AssignChip
        state="invited"
        value={{ email: 'invited@example.com' }}
        onOpenComposer={vi.fn()}
        onClear={vi.fn()}
      />,
    )
    expect(screen.getByText(/invited@example\.com/i)).toBeInTheDocument()
    expect(screen.getByText(/pending/i)).toBeInTheDocument()
  })
})

describe('AssignChip — lockedTo="self" (AC8 Solo Teacher pill)', () => {
  test('renders as <div> NOT <button>', () => {
    render(
      <AssignChip
        state="assigned"
        value={{
          userId: 'u1',
          email: 'solo@example.com',
          displayName: 'Solo Teacher',
          role: 'Solo',
        }}
        lockedTo="self"
        onOpenComposer={vi.fn()}
        onClear={vi.fn()}
      />,
    )

    // NO interactive button role — read-only <div>
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  test('click has no effect (lockedTo variant)', async () => {
    const onOpenComposer = vi.fn()
    const user = userEvent.setup()
    render(
      <AssignChip
        state="assigned"
        value={{
          userId: 'u1',
          email: 'solo@example.com',
          displayName: 'Solo Teacher',
          role: 'Owner',
        }}
        lockedTo="self"
        onOpenComposer={onOpenComposer}
        onClear={vi.fn()}
      />,
    )

    // R1-C2-P21 — strengthen: (a) assert the container is NOT a <button>
    // (structural check), (b) click the container itself, not a text child.
    const pill = screen.getByText('Solo Teacher')
    expect(pill.closest('button')).toBeNull()
    const container = pill.closest('[aria-label]') as HTMLElement
    expect(container.tagName).toBe('DIV')
    await user.click(container)
    expect(onOpenComposer).not.toHaveBeenCalled()
  })
})

describe('AssignChip — accessibility', () => {
  // R1-C2-P7 — extended matrix covers all 5 AC5 variants; the two most
  // structurally distinct branches (founder-auto-assign star + locked-to-self
  // <div>) MUST run axe or a regression to those shapes slips through.
  test.each([
    ['empty' as const, null, {}],
    [
      'assigned' as const,
      { userId: 'u1', email: 'a@e.com', displayName: 'A', role: 'T' },
      {},
    ],
    ['invited' as const, { email: 'i@e.com' }, {}],
    [
      'assigned' as const,
      { userId: 'u1', email: 'founder@e.com', displayName: 'Founder', role: 'Founder' },
      { starIcon: true },
    ],
    [
      'assigned' as const,
      { userId: 'u1', email: 'solo@e.com', displayName: 'Solo Teacher', role: 'Owner' },
      { lockedTo: 'self' as const },
    ],
  ])(
    '%s state (opts=%#): axe zero violations',
    async (state, value, opts: { starIcon?: boolean; lockedTo?: 'self' }) => {
      const { container } = render(
        <AssignChip
          state={state}
          value={value}
          onOpenComposer={vi.fn()}
          onClear={vi.fn()}
          starIcon={opts.starIcon}
          lockedTo={opts.lockedTo}
        />,
      )
      expect(await axe(container)).toHaveNoViolations()
    },
  )
})
