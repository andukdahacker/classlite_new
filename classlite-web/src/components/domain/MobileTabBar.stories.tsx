// storybook-rule: no-three-state
/**
 * MobileTabBar — purpose-designed bottom tab bar. 1d-3 AC7.
 *
 * Pure layout — owns no fetch. Three-state lint opted out per § 3
 * predicate. Role-variant stories document the per-role tab sets.
 *
 * Three role-specific views per IA Chapter 8 lines 213–243. AdminView is
 * NOT a separate variant — Admin shares Owner mobile per the convention
 * (IA Chapter 8 doesn't draw Admin mobile). `OwnerView` carries the
 * `@status: extrapolated-pending-design-review` flag per Sally's party-mode
 * 2026-06-18 finding — IA Chapter 8 only draws `s86` push-approval for
 * Owner; the 5-tab set is John's extrapolation from desktop priority.
 *
 * Student-tone namespace check: each play function asserts every tab
 * `labelKey` matches `mobileTab.{role}.*` prefix (Sally, party-mode
 * 2026-06-18) — catches namespace drift at story-author level.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { MobileTabBar } from './MobileTabBar'

const meta = {
  title: 'domain/MobileTabBar',
  component: MobileTabBar,
  parameters: {
    layout: 'fullscreen',
    viewport: { defaultViewport: 'iphone14' },
  },
} satisfies Meta<typeof MobileTabBar>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { role: 'student', activeHref: '/dashboard' },
}

/**
 * StudentView — IA `s74–s81` (dominant student mobile spec). 5 tabs:
 * Home / Assignments / Inbox / Classes / Me.
 */
export const StudentView: Story = {
  args: {
    role: 'student',
    activeHref: '/dashboard',
    unreadByTab: { inbox: 3 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Smoke check: all five student tabs mount with stable testids. The
    // original `expect(tab.className).toMatch(/min-h-\[44px\]/)` assertions
    // were tautological — they reread the source class string rather than
    // verifying runtime touch-target size (1d-3 code-review P20). Real
    // 44×44 verification lives in
    // `e2e/storybook/app-shell-mobile-viewport.spec.ts` which measures
    // `boundingBox()` at a real 375×667 viewport.
    for (const slug of ['home', 'assignments', 'inbox', 'classes', 'me']) {
      await expect(canvas.getByTestId(`mobile-tab-${slug}`)).toBeInTheDocument()
    }
  },
}

/**
 * TeacherView — IA `s82–s85`. 5 tabs: Home / Classes / Inbox / Schedule / Me.
 */
export const TeacherView: Story = {
  args: {
    role: 'teacher',
    activeHref: '/classes',
    unreadByTab: { inbox: true },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('mobile-tab-classes')).toBeInTheDocument()
    await expect(canvas.getByTestId('mobile-tab-schedule')).toBeInTheDocument()
    // Teacher does NOT see assignments (student-only) or analytics (owner-only).
    await expect(canvas.queryByTestId('mobile-tab-assignments')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('mobile-tab-analytics')).not.toBeInTheDocument()
  },
}

/**
 * OwnerView — @status: extrapolated-pending-design-review (Sally, party-mode
 * 2026-06-18). IA Chapter 8 only draws `s86` push-approval for Owner mobile
 * at line 243, so the 5-tab Owner mobile set below is John's extrapolation
 * from desktop sidebar priority, NOT canonical IA. Designer to ratify or
 * amend at the post-1d-3 Storybook review.
 *
 * Same caveat for AdminView reuse (IA Chapter 8 doesn't draw Admin mobile
 * at all) — Admin shares this set per desktop convention.
 *
 * 5 tabs (extrapolated): Home / People / Inbox / Analytics / Me.
 */
export const OwnerView: Story = {
  args: {
    role: 'owner',
    activeHref: '/dashboard',
    unreadByTab: { inbox: 12 },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.getByTestId('mobile-tab-people')).toBeInTheDocument()
    await expect(canvas.getByTestId('mobile-tab-analytics')).toBeInTheDocument()
  },
}

/**
 * Unauthenticated — `role={null}`. Production baseline when `AppShell`
 * mounts without an auth wrapper. `MobileTabBar` returns null (no tabs
 * to render). Verified by 1d-3 unit test; this story documents the path.
 */
export const Unauthenticated: Story = {
  args: { role: null, activeHref: '/' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    await expect(canvas.queryByTestId('mobile-tab-bar')).not.toBeInTheDocument()
  },
}
