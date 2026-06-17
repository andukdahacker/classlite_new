/**
 * Toggle — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoldIcon } from 'lucide-react'
import { Toggle } from './toggle'

const meta = {
  title: 'ui/Toggle',
  component: Toggle,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Toggle>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Toggle aria-label="Bold">Bold</Toggle>,
}

export const Pressed: Story = {
  render: () => (
    <Toggle aria-label="Bold" defaultPressed>
      Bold
    </Toggle>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Toggle aria-label="Bold" disabled>
      Bold
    </Toggle>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Toggle aria-label="Bold">
      <BoldIcon />
    </Toggle>
  ),
}
