/**
 * ContextMenu — Story 1d-2 AC3.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from './context-menu'

const meta = {
  title: 'ui/ContextMenu',
  component: ContextMenu,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ContextMenu>

export default meta
type Story = StoryObj<typeof meta>

function Surface({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid h-32 w-72 place-items-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export const Default: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger render={<Surface>Right click here</Surface>} />
      <ContextMenuContent>
        <ContextMenuLabel>Class actions</ContextMenuLabel>
        <ContextMenuItem>Open class</ContextMenuItem>
        <ContextMenuItem>Archive</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem disabled>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
  /*
   * AC3 keyboard-nav play deferred — ContextMenu shares Base UI's
   * portal + trigger architecture with DropdownMenu, which fires
   * production error #31 on `userEvent` interaction inside the test-
   * runner Chromium. The axe smoke-test still covers the static
   * rendered state. Arrow / Enter / Escape coverage moves to the
   * integration layer when 1d-3's role-based context menus wire real
   * keyboard shortcuts; re-enable here once Base UI stabilizes the
   * test-runner interop (code review 2026-06-17).
   */
}

export const WithSubmenu: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger render={<Surface>Right click here</Surface>} />
      <ContextMenuContent>
        <ContextMenuItem>New class</ContextMenuItem>
        <ContextMenuSub>
          <ContextMenuSubTrigger>Templates</ContextMenuSubTrigger>
          <ContextMenuSubContent>
            <ContextMenuItem>IELTS 7.0</ContextMenuItem>
            <ContextMenuItem>IELTS 6.5</ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const WithSeparators: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger render={<Surface>Right click here</Surface>} />
      <ContextMenuContent>
        <ContextMenuItem>Edit</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>Duplicate</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem>Archive</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const WithShortcuts: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger render={<Surface>Right click here</Surface>} />
      <ContextMenuContent>
        <ContextMenuItem>
          Save
          <ContextMenuShortcut>
            <kbd className="font-mono">⌘S</kbd>
          </ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem>
          Search
          <ContextMenuShortcut>
            <kbd className="font-mono">⌘K</kbd>
          </ContextMenuShortcut>
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}

export const Disabled: Story = {
  render: () => (
    <ContextMenu>
      <ContextMenuTrigger render={<Surface>Right click here</Surface>} />
      <ContextMenuContent>
        <ContextMenuItem>Edit</ContextMenuItem>
        <ContextMenuItem disabled>Archive</ContextMenuItem>
        <ContextMenuItem disabled>Delete</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  ),
}
