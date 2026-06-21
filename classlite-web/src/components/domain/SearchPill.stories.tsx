// storybook-rule: no-three-state
/**
 * SearchPill — `s06` topbar search affordance. 1d-3 AC1.
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3
 * predicate.
 *
 * Visual-only pill in this story; palette wiring lives in a downstream
 * feature story consuming 1d-2's `Command` primitive.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { SearchPill } from './SearchPill'

const meta = {
  title: 'domain/SearchPill',
  component: SearchPill,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof SearchPill>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { placeholderKey: 'topbar.search.placeholder' },
}
