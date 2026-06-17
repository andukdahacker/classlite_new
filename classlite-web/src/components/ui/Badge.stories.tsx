/**
 * Badge — Story 1d-2 AC4.
 *
 * `Count` variant uses `font-mono` (Geist Mono) per AC7 typography rule.
 * `LongVietnameseLabel` proves diacritic clearance at chip size — Badge
 * is the highest-density diacritic surface in the dashboard.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { XIcon, BellIcon } from 'lucide-react'
import { Badge } from './badge'

const meta = {
  title: 'ui/Badge',
  component: Badge,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Badge>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Badge>Active</Badge>,
}

export const Secondary: Story = {
  render: () => <Badge variant="secondary">Draft</Badge>,
}

export const Destructive: Story = {
  render: () => <Badge variant="destructive">Overdue</Badge>,
}

export const Outline: Story = {
  render: () => <Badge variant="outline">Archived</Badge>,
}

export const Removable: Story = {
  render: () => (
    <Badge>
      Filter
      <button
        type="button"
        aria-label="Remove filter"
        className="ml-1 inline-flex h-3 w-3 items-center justify-center"
      >
        <XIcon className="size-3" />
      </button>
    </Badge>
  ),
}

export const WithIcon: Story = {
  render: () => (
    <Badge>
      <BellIcon data-icon="inline-start" />
      Notification
    </Badge>
  ),
}

export const Count: Story = {
  render: () => <Badge className="font-mono">12</Badge>,
}

/**
 * Long Vietnamese label — verifies diacritic clearance + overflow at
 * chip size. Use real status copy ("Đã nộp bài tập" / "Chờ phê duyệt"),
 * not English ipsum.
 */
export const LongVietnameseLabel: Story = {
  render: () => (
    <div className="flex flex-col items-start gap-2">
      <Badge>Đã nộp bài tập</Badge>
      <Badge variant="secondary">Chờ phê duyệt</Badge>
      <Badge variant="destructive">Quá hạn</Badge>
    </div>
  ),
}
