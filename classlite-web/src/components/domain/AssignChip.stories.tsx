// storybook-rule: no-three-state
/**
 * AssignChip — teacher-assignment pill. Story 2-3b Task 4.1 canonical Epic
 * 1D 1d-7 debut (Amelia-B1 pre-flight: Storybook variant lands FIRST so the
 * visual language is pinned before ClassRow wire-up in Task 6.2).
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3 predicate.
 *
 * Reference visual language: `PersonaCard.tsx` avatar + name + role pill idiom
 * lifted for the assigned state.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { AssignChip } from './AssignChip'

const meta = {
  title: 'domain/AssignChip',
  component: AssignChip,
  parameters: { layout: 'centered' },
  args: {
    onOpenComposer: () => undefined,
    onClear: () => undefined,
  },
} satisfies Meta<typeof AssignChip>

export default meta
type Story = StoryObj<typeof meta>

export const Empty: Story = {
  args: {
    state: 'empty',
    value: null,
  },
}

export const Assigned: Story = {
  args: {
    state: 'assigned',
    value: {
      userId: 'user-1',
      email: 'alice@classlite.example',
      displayName: 'Alice Nguyen',
      role: 'Teacher',
    },
  },
}

export const Invited: Story = {
  args: {
    state: 'invited',
    value: { email: 'bob.pending@classlite.example' },
  },
}

export const FounderAutoAssign: Story = {
  args: {
    state: 'assigned',
    value: {
      userId: 'user-founder',
      email: 'founder@classlite.example',
      displayName: 'You',
      role: 'Founder',
    },
    starIcon: true,
  },
}

export const LockedToSelf: Story = {
  args: {
    state: 'assigned',
    value: {
      userId: 'user-solo',
      email: 'solo@classlite.example',
      displayName: 'You',
      role: 'Owner',
    },
    lockedTo: 'self',
  },
}

// R1-C2-P19 — additional variants that exercise fallback + edge-of-layout
// paths not covered by the primary five above.

/** Long displayName — validates word-wrap / truncation in the assigned pill. */
export const AssignedLongName: Story = {
  args: {
    state: 'assigned',
    value: {
      userId: 'user-longname',
      email: 'nguyen.thi.hoang.thanh@classlite.example',
      displayName: 'Nguyễn Thị Hoàng Thanh Ngân',
      role: 'Teacher',
    },
  },
}

/** Missing displayName — exercises the `??` initials fallback in labelContent. */
export const AssignedNoDisplayName: Story = {
  args: {
    state: 'assigned',
    value: {
      email: 'alice@classlite.example',
      role: 'Teacher',
    },
  },
}

/** Invited without email — exercises "Invited teacher" fallback copy. */
export const InvitedNoEmail: Story = {
  args: {
    state: 'invited',
    value: null,
  },
}
