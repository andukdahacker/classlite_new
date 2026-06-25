// storybook-rule: no-three-state — CollapsibleEmailForm is a controlled
// disclosure wrapper (no data fetching); the three-state contract does not
// apply.
/**
 * CollapsibleEmailForm stories — Story 1-8 AC1.
 */
import { useState } from 'react'
import type { Meta, StoryObj } from '@storybook/react-vite'
import CollapsibleEmailForm from './CollapsibleEmailForm'

const meta = {
  title: 'features/auth/CollapsibleEmailForm',
  component: CollapsibleEmailForm,
  parameters: {
    a11y: { test: 'error' },
  },
  args: {
    // Default args are overridden by each story's `render` because the
    // collapsed/expanded states require local useState.
    open: false,
    onOpenChange: () => undefined,
    triggerLabel: 'Sign in with email',
    children: null,
  },
} satisfies Meta<typeof CollapsibleEmailForm>

export default meta

type Story = StoryObj<typeof meta>

function CollapsedDemo() {
  const [open, setOpen] = useState(false)
  return (
    <CollapsibleEmailForm
      open={open}
      onOpenChange={setOpen}
      triggerLabel="Sign in with email"
    >
      <div className="grid gap-3">
        <input aria-label="Email" className="rounded-md border p-2" />
        <input
          type="password"
          aria-label="Password"
          className="rounded-md border p-2"
        />
      </div>
    </CollapsibleEmailForm>
  )
}

function ExpandedDemo() {
  const [open, setOpen] = useState(true)
  return (
    <CollapsibleEmailForm
      open={open}
      onOpenChange={setOpen}
      triggerLabel="Sign in with email"
    >
      <div className="grid gap-3">
        <input aria-label="Email" className="rounded-md border p-2" />
        <input
          type="password"
          aria-label="Password"
          className="rounded-md border p-2"
        />
      </div>
    </CollapsibleEmailForm>
  )
}

function ForcedOpenDemo() {
  // Simulates the server-validation-error force-expand path — the parent
  // pushes `open=true` even though the user hasn't clicked the trigger.
  const [open, setOpen] = useState(true)
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">
        Parent forced open after server returned 422.
      </p>
      <CollapsibleEmailForm
        open={open}
        onOpenChange={setOpen}
        triggerLabel="Sign in with email"
      >
        <input
          aria-label="Email"
          defaultValue="taken@example.com"
          aria-invalid={true}
          className="rounded-md border p-2"
        />
      </CollapsibleEmailForm>
    </div>
  )
}

const inheritedArgs = {
  open: false,
  onOpenChange: () => undefined,
  triggerLabel: 'Sign in with email',
  children: null,
}

export const Collapsed: Story = {
  args: inheritedArgs,
  render: () => <CollapsedDemo />,
}
export const Expanded: Story = {
  args: inheritedArgs,
  render: () => <ExpandedDemo />,
}
export const ForcedOpen: Story = {
  args: inheritedArgs,
  render: () => <ForcedOpenDemo />,
}
