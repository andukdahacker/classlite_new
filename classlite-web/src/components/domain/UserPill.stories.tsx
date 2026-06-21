// storybook-rule: no-three-state
/**
 * UserPill — `s06` sidebar foot identity slot. 1d-3 AC1.
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3
 * predicate.
 *
 * Data-driven role label (no role-conditional branches inside the
 * component). Stories exercise the four roles to confirm the label
 * lookup resolves via `userPill.role.{role}` keys.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { UserPill } from './UserPill'

const meta = {
  title: 'domain/UserPill',
  component: UserPill,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[220px] bg-sidebar p-3">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof UserPill>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { name: 'Jane Doe', role: 'owner' },
}

export const OwnerView: Story = {
  args: { name: 'Jane Doe', role: 'owner' },
}

export const AdminView: Story = {
  args: { name: 'Jane Doe', role: 'admin' },
}

export const TeacherView: Story = {
  args: { name: 'Jane Doe', role: 'teacher' },
}

export const StudentView: Story = {
  args: { name: 'Jane Doe', role: 'student' },
}
