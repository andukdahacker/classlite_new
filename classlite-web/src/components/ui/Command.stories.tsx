/**
 * Command — Story 1d-2 AC3.
 *
 * `Command` is the ⌘K palette base. `EmptyResults` consumes the
 * `storybook.command.empty` i18n key — NEVER hardcoded English. The
 * palette wiring itself defers to a follow-up consuming feature story.
 *
 * AC3 keyboard-nav play deferred — `cmdk` listbox semantics + Base UI's
 * Dialog composition under `CommandDialog` hit the same test-runner
 * Chromium interop pothole DropdownMenu carves out (#31 on userEvent
 * interaction). Static axe smoke is the only safe assertion here until
 * 1d-3's `CommandPalette` domain wrapper swaps to `role="combobox"`
 * semantics and re-runs keyboard coverage against the stable surface
 * (code review 2026-06-17).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from './command'

// `cmdk` renders `CommandList` as `role="listbox"`, but lets us nest
// `CommandSeparator` (`role="separator"`) inside. Axe's
// `aria-required-children` rule rejects this composition. The library
// behavior is upstream; the 1d-3 `CommandPalette` wrapper will swap to
// `role="combobox"` semantics for the published `⌘K` palette. Per
// AC8 governance: documented suppression on the primitive layer.
const meta = {
  title: 'ui/Command',
  component: Command,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [{ id: 'aria-required-children', enabled: false }],
      },
    },
  },
} satisfies Meta<typeof Command>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Classes">
          <CommandItem>IELTS 7.0 evening</CommandItem>
          <CommandItem>IELTS 6.5 morning</CommandItem>
          <CommandItem>Speaking lab</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const WithSubmenu: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Quick actions">
          <CommandItem>New class</CommandItem>
          <CommandItem>Invite teacher</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Templates">
          <CommandItem>IELTS 7.0</CommandItem>
          <CommandItem>IELTS 6.5</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const WithSeparators: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Classes">
          <CommandItem>IELTS 7.0 evening</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="People">
          <CommandItem>Invite teacher</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const WithShortcuts: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Actions">
          <CommandItem>
            New class
            <CommandShortcut>
              <kbd className="font-mono">⌘N</kbd>
            </CommandShortcut>
          </CommandItem>
          <CommandItem>
            Search
            <CommandShortcut>
              <kbd className="font-mono">⌘K</kbd>
            </CommandShortcut>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

export const Disabled: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Classes">
          <CommandItem>IELTS 7.0 evening</CommandItem>
          <CommandItem disabled>IELTS 6.5 morning</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}

function EmptyResultsImpl() {
  const { t } = useTranslation()
  return (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" value="xyzzy" />
      <CommandList>
        <CommandEmpty>{t('storybook.command.empty')}</CommandEmpty>
      </CommandList>
    </Command>
  )
}

export const EmptyResults: Story = {
  render: () => <EmptyResultsImpl />,
}

export const WithGroups: Story = {
  render: () => (
    <Command className="w-80 border border-border">
      <CommandInput placeholder="Search…" />
      <CommandList>
        <CommandGroup heading="Classes">
          <CommandItem>IELTS 7.0 evening</CommandItem>
          <CommandItem>IELTS 6.5 morning</CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Settings">
          <CommandItem>Center settings</CommandItem>
          <CommandItem>Roles &amp; permissions</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>
  ),
}
