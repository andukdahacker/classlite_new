// storybook-rule: no-three-state
/**
 * BreadcrumbBar — `s06` breadcrumb chrome. 1d-3 AC1.
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3
 * predicate (slot-only Props, no user-data conditional). The story
 * exports document the truncation variants instead.
 *
 * Wraps 1d-2's `Breadcrumb` primitive. Overrides the primitive's English
 * `aria-label="More"` and `BreadcrumbPage` role/aria-disabled shape per
 * deferred-work.md 2026-06-17 carry-overs.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { BreadcrumbBar } from './BreadcrumbBar'

const meta = {
  title: 'domain/BreadcrumbBar',
  component: BreadcrumbBar,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof BreadcrumbBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    items: [
      { label: 'Workspace', href: '/' },
      { label: 'Classes', href: '/classes' },
      { label: 'IELTS 7.0 evening' },
    ],
  },
}

export const WithEllipsis: Story = {
  args: {
    items: [
      { label: 'Workspace', href: '/' },
      { label: 'Classes', href: '/classes' },
      { label: 'IELTS 7.0 evening', href: '/classes/123' },
      { label: 'Sessions', href: '/classes/123/sessions' },
      { label: 'Session 4' },
    ],
    truncateAt: 3,
  },
}
