/**
 * HoverCard — Story 1d-2 AC2.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HoverCard, HoverCardContent, HoverCardTrigger } from './hover-card'
import { Button } from './button'

const meta = {
  title: 'ui/HoverCard',
  component: HoverCard,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof HoverCard>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <HoverCard>
      <HoverCardTrigger render={<Button variant="link">@ielts-coach</Button>} />
      <HoverCardContent>
        <div className="grid gap-1">
          <div className="text-sm font-medium">IELTS Coach</div>
          <div className="text-xs text-muted-foreground">
            18 classes · 240 students
          </div>
        </div>
      </HoverCardContent>
    </HoverCard>
  ),
}

export const Open: Story = {
  render: () => (
    <HoverCard open>
      <HoverCardTrigger render={<Button variant="link">@ielts-coach</Button>} />
      <HoverCardContent>Forced open</HoverCardContent>
    </HoverCard>
  ),
}

const POSITIONS = ['top', 'right', 'bottom', 'left'] as const

function PositionedVariant({ side }: { side: (typeof POSITIONS)[number] }) {
  return (
    <HoverCard open>
      <HoverCardTrigger render={<Button variant="outline">Side {side}</Button>} />
      <HoverCardContent side={side}>Side {side}</HoverCardContent>
    </HoverCard>
  )
}

export const Positioned: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-12">
      {POSITIONS.map((side) => (
        <PositionedVariant key={side} side={side} />
      ))}
    </div>
  ),
}
