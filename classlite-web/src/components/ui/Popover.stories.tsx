/**
 * Popover — Story 1d-2 AC2.
 *
 * `LongVietnameseContent` verifies overflow + word-wrap at typical
 * Vietnamese string length (~1.5× English; per 1D-P1-045..048 + UX-2).
 * The string is loaded from `storybook.placeholder.longViText`, never
 * English ipsum.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from './popover'
import { Button } from './button'

const meta = {
  title: 'ui/Popover',
  component: Popover,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Popover>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Popover>
      <PopoverTrigger render={<Button variant="outline">Open popover</Button>} />
      <PopoverContent>
        <PopoverHeader>
          <PopoverTitle>Quick settings</PopoverTitle>
          <PopoverDescription>Toggle inline preferences.</PopoverDescription>
        </PopoverHeader>
      </PopoverContent>
    </Popover>
  ),
}

export const Open: Story = {
  render: () => (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline">Open</Button>} />
      <PopoverContent>
        <PopoverTitle>Open by default</PopoverTitle>
      </PopoverContent>
    </Popover>
  ),
}

const POSITIONS = ['top', 'right', 'bottom', 'left'] as const

function PositionedVariant({ side }: { side: (typeof POSITIONS)[number] }) {
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline">Side {side}</Button>} />
      <PopoverContent side={side}>
        <PopoverTitle>Side {side}</PopoverTitle>
      </PopoverContent>
    </Popover>
  )
}

export const Positioned: Story = {
  render: () => (
    <div className="grid grid-cols-2 gap-16">
      {POSITIONS.map((side) => (
        <PositionedVariant key={side} side={side} />
      ))}
    </div>
  ),
}

function LongVietnameseImpl() {
  const { t } = useTranslation()
  return (
    <Popover defaultOpen>
      <PopoverTrigger render={<Button variant="outline">Open</Button>} />
      <PopoverContent className="max-w-xs leading-relaxed">
        <PopoverTitle>{t('storybook.popover.statusTitle')}</PopoverTitle>
        <PopoverDescription>
          {t('storybook.placeholder.longViText')}
        </PopoverDescription>
      </PopoverContent>
    </Popover>
  )
}

export const LongVietnameseContent: Story = {
  render: () => <LongVietnameseImpl />,
}
