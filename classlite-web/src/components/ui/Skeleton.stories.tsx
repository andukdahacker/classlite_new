/**
 * Skeleton — Story 1d-2 AC4.
 *
 * Five pure shape variants ONLY (per FW-7 + Winston's split). Shape-
 * semantic compositions (`SkeletonListRow`, `SkeletonTableRow`,
 * `SkeletonChartRectangle`) belong in `domain/` and defer to Epic 10
 * Story 10-3's `LoadingSkeleton` pattern set.
 *
 * Pulse animation reads from `--cl-skeleton-pulse-duration` and
 * `--cl-skeleton-pulse-easing` (tokens.css), gated on
 * `prefers-reduced-motion: no-preference` via the `motion-safe:` prefix.
 * The `ReducedMotion` story sets `parameters.reducedMotion: 'reduce'` —
 * the `preVisit` hook in `.storybook/test-runner.ts` calls
 * `page.emulateMedia({ reducedMotion })` so 1D-P1-049..052 can actually
 * assert the static branch.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { Skeleton } from './skeleton'

const meta = {
  title: 'ui/Skeleton',
  component: Skeleton,
  parameters: { layout: 'centered' },
} satisfies Meta<typeof Skeleton>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  render: () => <Skeleton className="h-12 w-48" />,
}

export const Rectangle: Story = {
  render: () => <Skeleton className="h-24 w-64" />,
}

export const Circle: Story = {
  render: () => <Skeleton className="size-16 rounded-full" />,
}

export const Text: Story = {
  render: () => (
    <div className="grid w-72 gap-2">
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-11/12" />
      <Skeleton className="h-4 w-9/12" />
    </div>
  ),
}

export const Card: Story = {
  render: () => (
    <div className="grid w-80 gap-3">
      <Skeleton className="h-32 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
    </div>
  ),
}

/**
 * Reduced-motion verification. `parameters.reducedMotion: 'reduce'` is
 * read by the test-runner `preVisit` hook and passed to
 * `page.emulateMedia({ reducedMotion: 'reduce' })`, which disables the
 * `motion-safe:animate-pulse` utility — the Skeleton renders static.
 *
 * The `play` function asserts the disabled state explicitly so
 * 1D-P1-049..052 does NOT pass vacuously (a story that only sets the
 * parameter without verifying the rendered animation state would still
 * be marked green even if the motion-safe gate ever broke upstream).
 */
export const ReducedMotion: Story = {
  parameters: { reducedMotion: 'reduce' },
  render: () => <Skeleton className="h-12 w-48" data-testid="reduced-skeleton" />,
  play: async ({ canvasElement }) => {
    const skeleton = await within(canvasElement).findByTestId('reduced-skeleton')
    await waitFor(() => {
      const style = window.getComputedStyle(skeleton)
      // `motion-safe:` gates the animation utility — under reduced-motion
      // emulation the rule never matches, so animationName collapses to 'none'.
      expect(style.animationName).toBe('none')
    })
  },
}
