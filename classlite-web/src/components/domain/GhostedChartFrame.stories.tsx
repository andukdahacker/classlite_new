// storybook-rule: no-three-state
/**
 * GhostedChartFrame — the ghosted chart placeholder for s57 / s61 (Story 10.3
 * AC2). Pure presentation; no fetch, no data branches, so the three-state rule
 * is opted out above. Static fill (no pulse), so nothing for `motion-reduce` to
 * disable. The frame + its em-dash placeholders are `aria-hidden` — the
 * accessible name always comes from the surrounding EmptyState.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { GhostedChartFrame } from './GhostedChartFrame'

const meta = {
  title: 'domain/GhostedChartFrame',
  component: GhostedChartFrame,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof GhostedChartFrame>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {}
