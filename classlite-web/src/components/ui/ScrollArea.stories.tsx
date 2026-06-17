/**
 * ScrollArea — Story 1d-2 AC5.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { ScrollArea } from './scroll-area'

const meta = {
  title: 'ui/ScrollArea',
  component: ScrollArea,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof ScrollArea>

export default meta
type Story = StoryObj<typeof meta>

const tags = Array.from({ length: 50 }, (_, i) => `Class ${i + 1}`)

export const Vertical: Story = {
  render: () => (
    <ScrollArea className="h-48 w-48 rounded-md border border-border p-3">
      <div className="grid gap-1">
        {tags.map((tag) => (
          <div key={tag} className="text-sm">{tag}</div>
        ))}
      </div>
    </ScrollArea>
  ),
}

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-96 whitespace-nowrap rounded-md border border-border p-3">
      <div className="flex gap-3">
        {tags.slice(0, 20).map((tag) => (
          <div key={tag} className="rounded-md bg-muted px-3 py-1 text-sm">
            {tag}
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}

export const Both: Story = {
  render: () => (
    <ScrollArea className="h-48 w-72 rounded-md border border-border p-3">
      <div className="grid w-[600px] gap-1">
        {tags.map((tag) => (
          <div key={tag} className="whitespace-nowrap text-sm">
            {tag} · long descriptive class name overflowing horizontally
          </div>
        ))}
      </div>
    </ScrollArea>
  ),
}
