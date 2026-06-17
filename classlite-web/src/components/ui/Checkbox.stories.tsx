/**
 * Checkbox — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Checkbox } from './checkbox'
import { Label } from './label'

const meta = {
  title: 'ui/Checkbox',
  component: Checkbox,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Checkbox>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Checkbox aria-label="Agree to terms" />,
}

export const Checked: Story = {
  render: () => <Checkbox aria-label="Agree to terms" defaultChecked />,
}

export const Disabled: Story = {
  render: () => <Checkbox aria-label="Agree to terms" disabled />,
}

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-2">
      <Checkbox id="agree" />
      <Label htmlFor="agree">I agree to the terms</Label>
    </div>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <div className="grid gap-1">
      <div className="flex items-center gap-2">
        <Checkbox id="opt-in" />
        <Label htmlFor="opt-in">Email notifications</Label>
      </div>
      <p className="pl-7 text-sm text-muted-foreground">
        Receive a daily digest of class activity.
      </p>
    </div>
  ),
}
