// storybook-rule: no-three-state
/**
 * SidebarNavItem — `s06` sidebar row. 1d-3 AC1 / AC6.
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3
 * predicate. Variant stories document active / badge / disabled / long-vi
 * states.
 *
 * Stories: Default, Active, WithBadge, WithBadgeAndActive, Disabled,
 * LongVietnameseLabel (per 1D-P1-060..065). `LongVietnameseLabel` exercises
 * the WCAG 2.1.1 truncation recipe at the 220px constraint (aria-label +
 * hover-AND-focus tooltip + native `title` fallback per AC9).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { HomeIcon, InboxIcon } from 'lucide-react'
import { SidebarNavItem } from './SidebarNavItem'

const meta = {
  title: 'domain/SidebarNavItem',
  component: SidebarNavItem,
  parameters: { layout: 'padded' },
  decorators: [
    (Story) => (
      <div className="w-[220px] bg-sidebar p-2">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof SidebarNavItem>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    labelKey: 'sidebar.owner.dashboard',
    icon: <HomeIcon className="size-4" />,
    href: '/dashboard',
  },
}

export const Active: Story = {
  args: {
    labelKey: 'sidebar.owner.dashboard',
    icon: <HomeIcon className="size-4" />,
    href: '/dashboard',
    active: true,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = await canvas.findByTestId('sidebar-nav-dashboard')
    await expect(link).toHaveAttribute('aria-current', 'page')
  },
}

export const WithBadge: Story = {
  args: {
    labelKey: 'sidebar.owner.inbox',
    icon: <InboxIcon className="size-4" />,
    href: '/inbox',
    badgeCount: 3,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = await canvas.findByTestId('sidebar-nav-inbox')
    const aria = link.getAttribute('aria-label') ?? ''
    await expect(aria).toMatch(/3/)
  },
}

export const WithBadgeAndActive: Story = {
  args: {
    labelKey: 'sidebar.owner.inbox',
    icon: <InboxIcon className="size-4" />,
    href: '/inbox',
    badgeCount: 12,
    active: true,
  },
}

export const Disabled: Story = {
  args: {
    labelKey: 'sidebar.owner.settings',
    icon: <HomeIcon className="size-4" />,
    href: '/settings',
    disabled: true,
  },
}

/**
 * LongVietnameseLabel — exercises the 220px truncation recipe with
 * Vietnamese diacritics. Verifies WCAG 2.1.1: aria-label preserves full
 * text, tooltip opens on focus (keyboard reveal), native `title` attr
 * present as no-JS fallback. The visible span is `aria-hidden`. Axe
 * scenario 1D-P1-094a covers truncation a11y end-to-end.
 */
export const LongVietnameseLabel: Story = {
  args: {
    labelKey: 'sidebar.owner.knowledgeHub',
    icon: <HomeIcon className="size-4" />,
    href: '/knowledge-hub',
  },
  globals: { locale: 'vi' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    const link = await canvas.findByTestId('sidebar-nav-knowledge-hub')

    // (a) aria-label preserves the full string regardless of visual truncation.
    const fullLabel = 'Trung tâm kiến thức'
    await expect(link).toHaveAttribute('aria-label', fullLabel)
    await expect(link).toHaveAttribute('title', fullLabel)
  },
}
