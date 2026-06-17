/**
 * Progress — Story 1d-2 AC4.
 *
 * `Warn` / `Critical` / `Complete` recolor the indicator via Tailwind
 * arbitrary-value escapes for the missing-from-bridge semantic tokens
 * (success / warning / destructive-fill) — never inline `style={{}}`.
 * The contract `PlanUsageMeter` and `BillingGraceBanner` (deferred) will
 * consume.
 *
 * AC7 `font-mono` mapping for "Progress percentage labels" lives in the
 * consumer's domain wrapper (e.g., the deferred `PlanUsageMeter`) — the
 * primitive itself renders no `%` text. When the wrapper lands, its
 * story slots `<span className="font-mono">{value}%</span>` next to the
 * Progress and exercises the typography contract there. The primitive
 * stays slot-free (code review 2026-06-17 deferral).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, waitFor, within } from 'storybook/test'
import { Progress } from './progress'

// `value` on the Progress primitive is required at the type level; stories
// supply it inline per variant, so the meta omits the component typing
// to keep variant args ergonomic.
const meta = {
  title: 'ui/Progress',
  parameters: { layout: 'centered' },
} satisfies Meta

export default meta
type Story = StoryObj

export const Default: Story = {
  render: () => <Progress value={45} className="w-72" aria-label="Default progress" />,
}

export const Indeterminate: Story = {
  parameters: { reducedMotion: 'no-preference' },
  render: () => <Progress value={null} className="w-72" aria-label="Loading" />,
}

export const Warn: Story = {
  render: () => (
    <Progress
      value={70}
      aria-label="Warn progress"
      className="w-72 [&_[data-slot=progress-indicator]]:bg-[color:var(--cl-amber)]"
    />
  ),
}

export const Critical: Story = {
  render: () => (
    <Progress
      value={92}
      aria-label="Critical progress"
      className="w-72 [&_[data-slot=progress-indicator]]:bg-[color:var(--cl-red)]"
    />
  ),
}

export const Complete: Story = {
  render: () => (
    <Progress
      value={100}
      aria-label="Complete progress"
      className="w-72 [&_[data-slot=progress-indicator]]:bg-[color:var(--cl-green)]"
    />
  ),
}

/**
 * Reduced-motion verification — `parameters.reducedMotion: 'reduce'`
 * disables the indeterminate animation via the test-runner `preVisit`
 * hook (`page.emulateMedia({ reducedMotion: 'reduce' })`).
 *
 * The `play` function explicitly asserts the indicator's animationName
 * collapses to 'none' so 1D-P1-049..052 does not pass vacuously.
 */
export const IndeterminateReducedMotion: Story = {
  parameters: { reducedMotion: 'reduce' },
  render: () => (
    <Progress
      value={null}
      className="w-72"
      aria-label="Loading (reduced motion)"
      data-testid="reduced-progress"
    />
  ),
  play: async ({ canvasElement }) => {
    const root = await within(canvasElement).findByTestId('reduced-progress')
    const indicator = root.querySelector('[data-slot="progress-indicator"]')
    expect(indicator).toBeTruthy()
    await waitFor(() => {
      const style = window.getComputedStyle(indicator as Element)
      expect(style.animationName).toBe('none')
    })
  },
}
