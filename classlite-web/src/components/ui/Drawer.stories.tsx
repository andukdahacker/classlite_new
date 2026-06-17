/**
 * Drawer — Story 1d-2 AC2.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, screen, userEvent, waitFor, within } from 'storybook/test'
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from './drawer'
import { Button } from './button'

const meta = {
  title: 'ui/Drawer',
  component: Drawer,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Drawer>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Drawer>
      <DrawerTrigger asChild>
        <Button variant="outline">Open drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Bottom drawer</DrawerTitle>
          <DrawerDescription>
            Slide-up panel for mobile-first interactions.
          </DrawerDescription>
        </DrawerHeader>
        <DrawerFooter>
          <Button>Confirm</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const trigger = await canvas.findByRole('button', { name: /open drawer/i })
    await userEvent.click(trigger)
    // vaul Drawer portals to document.body — query via `screen`.
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    await waitFor(() => expect(trigger).toHaveFocus())
  },
}

export const Open: Story = {
  render: () => (
    <Drawer defaultOpen>
      <DrawerTrigger asChild>
        <Button>Open drawer</Button>
      </DrawerTrigger>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Open by default</DrawerTitle>
        </DrawerHeader>
      </DrawerContent>
    </Drawer>
  ),
}
