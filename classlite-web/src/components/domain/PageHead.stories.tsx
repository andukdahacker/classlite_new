/**
 * PageHead — `s06` page header. 1d-3 AC1.
 *
 * Three-state coverage uses the canonical `EmptyState` (Story 10.3) /
 * 1d-1's `ErrorState` (until Story 10.4 ships the canonical
 * error shape). Per Murat (party-mode 2026-06-18):
 * these stories cover the VISUAL SHAPE of those states for design
 * review; the loading-state correctness of any consumer fetch is
 * verified at the CONSUMER story (Epic 2+) — no MSW handler here.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { EmptyState } from '@/components/domain/EmptyState'
import { ErrorState } from './ErrorState'
import { PageHead } from './PageHead'

const meta = {
  title: 'domain/PageHead',
  component: PageHead,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof PageHead>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: {
    titleKey: 'pageHead.fixture.title',
    count: 5,
    subKey: 'pageHead.fixture.subtitle',
  },
}

export const Loading: Story = {
  args: { titleKey: 'pageHead.fixture.title' },
  render: () => (
    <div className="space-y-3">
      <div
        role="status"
        aria-label="Loading"
        className="h-8 w-48 animate-pulse rounded bg-muted"
      />
      <div className="h-4 w-64 animate-pulse rounded bg-muted/60" />
    </div>
  ),
}

export const Empty: Story = {
  args: { titleKey: 'pageHead.fixture.title' },
  render: () => <EmptyState headline="Nothing here yet" />,
}

export const Error: Story = {
  args: { titleKey: 'pageHead.fixture.title' },
  render: () => <ErrorState message="We couldn't load this page. Try again." />,
}
