/**
 * RadioGroup — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { RadioGroup, RadioGroupItem } from './radio-group'
import { Label } from './label'

const meta = {
  title: 'ui/RadioGroup',
  component: RadioGroup,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof RadioGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <RadioGroup defaultValue="morning">
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-morning" value="morning" />
        <Label htmlFor="r-morning">Morning</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="r-evening" value="evening" />
        <Label htmlFor="r-evening">Evening</Label>
      </div>
    </RadioGroup>
  ),
}

export const Checked: Story = {
  render: () => (
    <RadioGroup defaultValue="b">
      <div className="flex items-center gap-2">
        <RadioGroupItem id="b1" value="a" />
        <Label htmlFor="b1">Option A</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="b2" value="b" />
        <Label htmlFor="b2">Option B</Label>
      </div>
    </RadioGroup>
  ),
}

export const Disabled: Story = {
  render: () => (
    <RadioGroup defaultValue="d1" disabled>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="d1" value="d1" />
        <Label htmlFor="d1">Disabled A</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem id="d2" value="d2" />
        <Label htmlFor="d2">Disabled B</Label>
      </div>
    </RadioGroup>
  ),
}

export const WithLabel: Story = {
  render: () => (
    <fieldset className="grid gap-3 border border-border p-4">
      <legend className="text-sm font-medium">Class schedule</legend>
      <RadioGroup defaultValue="weekday">
        <div className="flex items-center gap-2">
          <RadioGroupItem id="w1" value="weekday" />
          <Label htmlFor="w1">Weekday evening</Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem id="w2" value="weekend" />
          <Label htmlFor="w2">Weekend morning</Label>
        </div>
      </RadioGroup>
    </fieldset>
  ),
}

export const WithDescription: Story = {
  render: () => (
    <RadioGroup defaultValue="weekday">
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <RadioGroupItem id="d-wd" value="weekday" />
          <Label htmlFor="d-wd">Weekday evening</Label>
        </div>
        <p className="pl-7 text-sm text-muted-foreground">
          18:00 — 20:00, Mon–Fri
        </p>
      </div>
      <div className="grid gap-1">
        <div className="flex items-center gap-2">
          <RadioGroupItem id="d-we" value="weekend" />
          <Label htmlFor="d-we">Weekend morning</Label>
        </div>
        <p className="pl-7 text-sm text-muted-foreground">
          09:00 — 11:00, Sat–Sun
        </p>
      </div>
    </RadioGroup>
  ),
}
