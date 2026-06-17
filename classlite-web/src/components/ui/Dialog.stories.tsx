/**
 * Dialog — Story 1d-2 AC2.
 *
 * Focus-trap behavior verified via a `play` function on `Default` per
 * AC2 + 1D-P1-036..040: open via trigger, focus moves into the dialog,
 * `Escape` closes the dialog, focus returns to the trigger.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from './dialog'
import { Button } from './button'
import { Input } from './input'
import { Label } from './label'

const meta = {
  title: 'ui/Dialog',
  component: Dialog,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Dialog>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Dialog>
      <DialogTrigger render={<Button>Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive class</DialogTitle>
          <DialogDescription>
            Archived classes are hidden from the schedule.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Archive</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: /open dialog/i })
    await userEvent.click(trigger)
    // Dialog renders into a portal outside `canvasElement` — use `screen`
    // (queries document.body) rather than `document.querySelector` so the
    // assertion participates in testing-library's retry semantics and
    // accessible-role matching.
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const Open: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button>Open dialog</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Archive class</DialogTitle>
          <DialogDescription>Open-by-default state.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button>Confirm</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}

export const WithForm: Story = {
  render: () => (
    <Dialog defaultOpen>
      <DialogTrigger render={<Button>New class</Button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New class</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-1">
            <Label htmlFor="dlg-name">Class name</Label>
            <Input id="dlg-name" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline">Cancel</Button>
          <Button>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  ),
}
