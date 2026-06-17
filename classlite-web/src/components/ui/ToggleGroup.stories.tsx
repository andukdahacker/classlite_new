/**
 * ToggleGroup — Story 1d-2 AC1.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BoldIcon, ItalicIcon, UnderlineIcon } from 'lucide-react'
import { ToggleGroup, ToggleGroupItem } from './toggle-group'

// Base UI's ToggleGroup primitive sets `aria-orientation` on `role="group"`
// — axe rejects `aria-orientation` on that role (aria-allowed-attr). The
// attribute is meaningful for screen readers traversing horizontal vs
// vertical groups; cleaner ARIA semantics need `role="toolbar"` upstream.
// Per AC8 governance: documented suppression at the primitive level.
const meta = {
  title: 'ui/ToggleGroup',
  component: ToggleGroup,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [{ id: 'aria-allowed-attr', enabled: false }],
      },
    },
  },
} satisfies Meta<typeof ToggleGroup>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <ToggleGroup defaultValue={['bold']} aria-label="Text formatting">
      <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
      <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Single: Story = {
  render: () => (
    <ToggleGroup aria-label="Single value">
      <ToggleGroupItem value="a">A</ToggleGroupItem>
      <ToggleGroupItem value="b">B</ToggleGroupItem>
      <ToggleGroupItem value="c">C</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const Multiple: Story = {
  render: () => (
    <ToggleGroup defaultValue={['bold', 'italic']} aria-label="Text formatting">
      <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
      <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const WithIcons: Story = {
  render: () => (
    <ToggleGroup aria-label="Text formatting (icons)">
      <ToggleGroupItem value="bold" aria-label="Bold">
        <BoldIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="italic" aria-label="Italic">
        <ItalicIcon />
      </ToggleGroupItem>
      <ToggleGroupItem value="underline" aria-label="Underline">
        <UnderlineIcon />
      </ToggleGroupItem>
    </ToggleGroup>
  ),
}

export const WithLabels: Story = {
  render: () => (
    <ToggleGroup defaultValue={['list']} aria-label="View mode">
      <ToggleGroupItem value="list">List</ToggleGroupItem>
      <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
      <ToggleGroupItem value="board">Board</ToggleGroupItem>
    </ToggleGroup>
  ),
}
