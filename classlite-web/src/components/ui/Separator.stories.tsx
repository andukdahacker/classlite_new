/**
 * Separator — Story 1d-2 AC5.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Separator } from './separator'

const meta = {
  title: 'ui/Separator',
  component: Separator,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Separator>

export default meta
type Story = StoryObj<typeof meta>

export const Horizontal: Story = {
  render: () => (
    <div className="w-72">
      <p>Above</p>
      <Separator className="my-3" />
      <p>Below</p>
    </div>
  ),
}

export const Vertical: Story = {
  render: () => (
    <div className="flex h-16 items-center gap-3">
      <span>Left</span>
      <Separator orientation="vertical" />
      <span>Right</span>
    </div>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <div className="flex w-72 items-center gap-3 text-xs uppercase text-muted-foreground">
      <Separator className="flex-1" />
      <span>or</span>
      <Separator className="flex-1" />
    </div>
  ),
}
