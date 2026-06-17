/**
 * Collapsible — Story 1d-2 AC5.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from './collapsible'
import { Button } from './button'

const meta = {
  title: 'ui/Collapsible',
  component: Collapsible,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Collapsible>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Collapsible className="w-72">
      <CollapsibleTrigger render={<Button variant="outline">Show details</Button>} />
      <CollapsibleContent>
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          18 enrolled · Mon / Wed / Fri at 18:00
        </div>
      </CollapsibleContent>
    </Collapsible>
  ),
}

function ControlledDemo() {
  const [open, setOpen] = useState(false)
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="w-72">
      <CollapsibleTrigger
        render={<Button variant="outline">{open ? 'Hide' : 'Show'}</Button>}
      />
      <CollapsibleContent>
        <div className="rounded-md border border-border bg-card p-3 text-sm">
          Controlled state — parent owns open / closed.
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}

export const Controlled: Story = {
  render: () => <ControlledDemo />,
}
