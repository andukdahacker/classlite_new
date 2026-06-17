/**
 * Tooltip — Story 1d-2 AC2.
 *
 * Content uses `leading-relaxed` (1.625) for Vietnamese diacritic
 * clearance — see the `// CL-THEME-SWAP:` note in tooltip.tsx.
 *
 * `LongVietnameseContent` verifies overflow + word-wrap at ~1.5× length
 * via `storybook.placeholder.longViText`.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useTranslation } from 'react-i18next'
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip'
import { Button } from './button'

const meta = {
  title: 'ui/Tooltip',
  component: Tooltip,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Tooltip>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => (
    <Tooltip>
      <TooltipTrigger render={<Button variant="outline">Hover</Button>} />
      <TooltipContent>Brief explanation</TooltipContent>
    </Tooltip>
  ),
}

export const Open: Story = {
  render: () => (
    <Tooltip open>
      <TooltipTrigger render={<Button variant="outline">Hover</Button>} />
      <TooltipContent>Forced open</TooltipContent>
    </Tooltip>
  ),
}

const POSITIONS = ['top', 'right', 'bottom', 'left'] as const

function PositionedVariant({ side }: { side: (typeof POSITIONS)[number] }) {
  return (
    <Tooltip open>
      <TooltipTrigger render={<Button variant="outline">Side {side}</Button>} />
      <TooltipContent side={side}>{side}</TooltipContent>
    </Tooltip>
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

function LongVietnameseImpl() {
  const { t } = useTranslation()
  return (
    <Tooltip open>
      <TooltipTrigger
        render={
          <Button variant="outline">{t('storybook.tooltip.statusTrigger')}</Button>
        }
      />
      <TooltipContent>{t('storybook.placeholder.longViText')}</TooltipContent>
    </Tooltip>
  )
}

export const LongVietnameseContent: Story = {
  render: () => <LongVietnameseImpl />,
}
