/**
 * Switch — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { Switch } from './switch'
import { Label } from './label'

const meta = {
  title: 'ui/Switch',
  component: Switch,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Switch>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Switch aria-label="Send notifications" />,
}

export const Checked: Story = {
  render: () => <Switch aria-label="Send notifications" defaultChecked />,
}

export const Disabled: Story = {
  render: () => <Switch aria-label="Send notifications" disabled />,
}

export const WithLabel: Story = {
  render: () => (
    <div className="flex items-center gap-3">
      <Switch id="notify" />
      <Label htmlFor="notify">Send notifications</Label>
    </div>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <div className="grid gap-1">
      <div className="flex items-center gap-3">
        <Switch id="auto-grade" aria-describedby="auto-grade-desc" />
        <Label htmlFor="auto-grade">AI auto-grade writing</Label>
      </div>
      <p id="auto-grade-desc" className="pl-12 text-sm text-muted-foreground">
        Drafts a band score before the teacher reviews.
      </p>
    </div>
  ),
}
