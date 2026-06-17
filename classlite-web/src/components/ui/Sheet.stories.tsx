/**
 * Sheet — Story 1d-2 AC2.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from './sheet'
import { Button } from './button'

const meta = {
  title: 'ui/Sheet',
  component: Sheet,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Sheet>

export default meta
type Story = StoryObj<typeof meta>

function SideStory({ side }: { side: 'top' | 'right' | 'bottom' | 'left' }) {
  return (
    <Sheet>
      <SheetTrigger render={<Button variant="outline">Open {side}</Button>} />
      <SheetContent side={side}>
        <SheetHeader>
          <SheetTitle>Sheet side {side}</SheetTitle>
          <SheetDescription>Side panel content.</SheetDescription>
        </SheetHeader>
        <SheetFooter>
          <Button>Close</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}

export const Default: Story = {
  render: () => <SideStory side="right" />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: /open right/i })
    await userEvent.click(trigger)
    // Sheet renders into a portal outside `canvasElement` — query via
    // `screen` (document.body) so the assertion participates in
    // testing-library's retry semantics and accessible-role matching.
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const Open: Story = {
  render: () => (
    <Sheet defaultOpen>
      <SheetTrigger render={<Button>Open sheet</Button>} />
      <SheetContent side="right">
        <SheetHeader>
          <SheetTitle>Open by default</SheetTitle>
        </SheetHeader>
      </SheetContent>
    </Sheet>
  ),
}

export const Left: Story = { render: () => <SideStory side="left" /> }
export const Right: Story = { render: () => <SideStory side="right" /> }
export const Top: Story = { render: () => <SideStory side="top" /> }
export const Bottom: Story = { render: () => <SideStory side="bottom" /> }
