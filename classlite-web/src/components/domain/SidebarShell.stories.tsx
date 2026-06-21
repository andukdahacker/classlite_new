/**
 * SidebarShell — `s06` 220px sidebar with four role variants. 1d-3 AC2–AC5.
 *
 * Per-role nav sets are sourced from `classlite-ia.md` lines 16–19 EXACTLY
 * via `sidebarNavConfig.tsx`. `AdminView`, `TeacherView`, and `StudentView`
 * `play` functions assert ABSENCE of disallowed nav items (per TEST-FE-6 —
 * test what's absent, not just present). The `BillingGraceBanner` slot is
 * NOT rendered by `SidebarShell` itself; it lives at the `AppShell` level
 * when active (deferred to Epic 9 per Path B re-scope).
 *
 * Student-tone enforcement (Sally, party-mode 2026-06-18): each per-role
 * view `play` function asserts every nav item's `labelKey` matches its
 * role prefix (`sidebar.{role}.*`) — catches namespace drift at story
 * author level, not just code review.
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { SidebarShell } from './SidebarShell'
import { SIDEBAR_NAV_BY_ROLE } from './sidebarNavConfig'

const meta = {
  title: 'domain/SidebarShell',
  component: SidebarShell,
  parameters: { layout: 'fullscreen' },
  args: {
    user: { name: 'Jane Doe', avatarUrl: null },
    activeHref: '/dashboard',
  },
} satisfies Meta<typeof SidebarShell>

export default meta
type Story = StoryObj<typeof meta>

function assertNamespacePrefix(
  groups: ReadonlyArray<{ items: ReadonlyArray<{ labelKey: string }> }>,
  prefix: string,
) {
  for (const group of groups) {
    for (const item of group.items) {
      if (!item.labelKey.startsWith(prefix)) {
        throw new Error(
          `student-tone / role-namespace violation: ${item.labelKey} should start with ${prefix}`,
        )
      }
    }
  }
}

export const Default: Story = {
  args: {
    role: 'owner',
    groups: SIDEBAR_NAV_BY_ROLE.owner,
  },
}

/**
 * OwnerView — IA line 16 (9 items, ordered):
 *   Dashboard / People / Classes / Schedule / Analytics / Inbox /
 *   Knowledge hub / Archive / Settings (Owner-only).
 */
export const OwnerView: Story = {
  args: {
    role: 'owner',
    groups: SIDEBAR_NAV_BY_ROLE.owner,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    assertNamespacePrefix(SIDEBAR_NAV_BY_ROLE.owner, 'sidebar.owner.')

    // Owner sees Settings (per IA line 16 + visibility matrix line 303).
    await expect(canvas.getByTestId('sidebar-nav-settings')).toBeInTheDocument()
    // Owner sees Knowledge hub + Archive (slug kebab-cased from camelCase).
    await expect(canvas.getByTestId('sidebar-nav-knowledge-hub')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-archive')).toBeInTheDocument()
    // Role pill renders 'Owner'.
    const userPillRole = canvas.getByTestId('user-pill-role')
    await expect(userPillRole.textContent ?? '').toMatch(/Owner/)
  },
}

/**
 * AdminView — IA line 17 = Owner MINUS Settings (per visibility matrix
 * line 303 "Center settings (s49) | — | — | — | A"). 8 items.
 * Absence-asserts Settings (per TEST-FE-6 + 1D-P0-016).
 */
export const AdminView: Story = {
  args: {
    role: 'admin',
    groups: SIDEBAR_NAV_BY_ROLE.admin,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    assertNamespacePrefix(SIDEBAR_NAV_BY_ROLE.admin, 'sidebar.admin.')

    // Admin sees standard nav.
    await expect(canvas.getByTestId('sidebar-nav-dashboard')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-people')).toBeInTheDocument()
    // Admin does NOT see Settings (absence assertion).
    await expect(canvas.queryByTestId('sidebar-nav-settings')).not.toBeInTheDocument()
    const userPillRole = canvas.getByTestId('user-pill-role')
    await expect(userPillRole.textContent ?? '').toMatch(/Admin/)
  },
}

/**
 * TeacherView — IA line 18 (10 items, ordered). No People, no Settings.
 * Absence-asserts both (per TEST-FE-6 + 1D-P0-017).
 */
export const TeacherView: Story = {
  args: {
    role: 'teacher',
    groups: SIDEBAR_NAV_BY_ROLE.teacher,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    assertNamespacePrefix(SIDEBAR_NAV_BY_ROLE.teacher, 'sidebar.teacher.')

    await expect(canvas.getByTestId('sidebar-nav-students')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-exercises')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-questions')).toBeInTheDocument()
    // Teacher does NOT see Settings or People (absence).
    await expect(canvas.queryByTestId('sidebar-nav-settings')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('sidebar-nav-people')).not.toBeInTheDocument()
    const userPillRole = canvas.getByTestId('user-pill-role')
    await expect(userPillRole.textContent ?? '').toMatch(/Teacher/)
  },
}

/**
 * StudentView — IA line 19 (7 items, student-tone labels). Drops the
 * "Resources" group (Knowledge hub, Archive — owner/teacher-only per
 * visibility matrix lines 294-295) AND the People/Analytics entries.
 * Most-restrictive role; carries the most absence assertions
 * (per TEST-FE-6 + 1D-P0-018).
 */
export const StudentView: Story = {
  args: {
    role: 'student',
    groups: SIDEBAR_NAV_BY_ROLE.student,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    assertNamespacePrefix(SIDEBAR_NAV_BY_ROLE.student, 'sidebar.student.')

    // Student sees student-tone labels.
    await expect(canvas.getByTestId('sidebar-nav-my-classes')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-my-schedule')).toBeInTheDocument()
    await expect(canvas.getByTestId('sidebar-nav-my-performance')).toBeInTheDocument()

    // Student does NOT see Settings / People / Knowledge hub / Archive / Analytics.
    await expect(canvas.queryByTestId('sidebar-nav-settings')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('sidebar-nav-people')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('sidebar-nav-knowledge-hub')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('sidebar-nav-archive')).not.toBeInTheDocument()
    await expect(canvas.queryByTestId('sidebar-nav-analytics')).not.toBeInTheDocument()

    const userPillRole = canvas.getByTestId('user-pill-role')
    await expect(userPillRole.textContent ?? '').toMatch(/Student/)
  },
}
