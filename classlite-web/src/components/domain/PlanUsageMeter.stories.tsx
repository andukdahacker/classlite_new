// storybook-rule: no-three-state
/**
 * PlanUsageMeter — Story 9-1b (AC21). The reserved-name meter promised by the
 * `ui/Progress` story. A pure presentational component (no data fetch → no
 * loading/empty/error trilogy, hence the no-three-state opt-out): it renders
 * the server usage contract verbatim across three units, with `.warn` driven by
 * the server `approaching` flag and suppressed for unlimited (`max === null`).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { PlanUsageMeter } from './PlanUsageMeter'

const meta = {
  title: 'domain/PlanUsageMeter',
  component: PlanUsageMeter,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof PlanUsageMeter>

export default meta
type Story = StoryObj<typeof meta>

export const Count: Story = {
  args: { unit: 'count', value: 3, max: 10, warn: false, label: 'Teacher seats' },
}

export const CountApproaching: Story = {
  args: { unit: 'count', value: 9, max: 10, warn: true, label: 'Teacher seats' },
}

export const Unlimited: Story = {
  args: { unit: 'count', value: 42, max: null, warn: true, label: 'Classes' },
}

export const Storage: Story = {
  args: {
    unit: 'bytes',
    value: 48_000_000_000,
    max: 53_687_091_200,
    warn: true,
    label: 'Storage',
  },
}

export const Credits: Story = {
  args: {
    unit: 'credits',
    value: 100,
    max: 2000,
    warn: false,
    resetAt: '2026-10-01T00:00:00+07:00',
    label: 'AI credits',
  },
}
