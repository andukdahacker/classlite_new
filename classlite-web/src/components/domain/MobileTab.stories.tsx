// storybook-rule: no-three-state
/**
 * MobileTab — single bottom-tab cell. 1d-3 AC7 sub-component.
 *
 * Pure layout — sub-component of MobileTabBar; owns no fetch. Three-state
 * lint opted out per § 3 predicate.
 *
 * Verifies the touch-target minimum and unread-badge variants in isolation.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { HomeIcon } from 'lucide-react'
import { MobileTab } from './MobileTab'

const meta = {
  title: 'domain/MobileTab',
  component: MobileTab,
  parameters: { layout: 'centered' },
  decorators: [
    (Story) => (
      <div className="flex w-[120px] justify-center border border-border bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof MobileTab>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    labelKey: 'mobileTab.student.home',
    icon: <HomeIcon className="size-4" />,
    href: '/dashboard',
    testIdSlug: 'home',
  },
}

export const Active: Story = {
  args: {
    labelKey: 'mobileTab.student.home',
    icon: <HomeIcon className="size-4" />,
    href: '/dashboard',
    active: true,
    testIdSlug: 'home',
  },
}

export const WithDotBadge: Story = {
  args: {
    labelKey: 'mobileTab.student.inbox',
    icon: <HomeIcon className="size-4" />,
    href: '/inbox',
    hasUnread: true,
    testIdSlug: 'inbox',
  },
}

export const WithCountBadge: Story = {
  args: {
    labelKey: 'mobileTab.student.inbox',
    icon: <HomeIcon className="size-4" />,
    href: '/inbox',
    hasUnread: 5,
    testIdSlug: 'inbox',
  },
}

export const WithOverflowBadge: Story = {
  args: {
    labelKey: 'mobileTab.student.inbox',
    icon: <HomeIcon className="size-4" />,
    href: '/inbox',
    hasUnread: 42,
    testIdSlug: 'inbox',
  },
}
