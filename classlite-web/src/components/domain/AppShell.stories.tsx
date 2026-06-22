/**
 * AppShell — top-level layout composing SidebarShell + TopbarShell +
 * MobileTabBar. 1d-3 AC1 / AC8.
 *
 * AC8: SidebarShell is ABSENT from the DOM below `md` (not just CSS-hidden
 * — per TEST-FE-6 + 1D-P0-020). The selector discipline (Murat, party-mode
 * 2026-06-18) uses `data-testid="sidebar-nav-primary"` for negative
 * assertions so the test stays decoupled from i18n string resolution.
 *
 * Stories exported: Desktop, Mobile, MobileWithBillingGrace, Tablet
 * (per 1D-P1-066..069). MobileWithBillingGrace exercises the
 * `BillingGraceBanner` slot stub (real banner ships in Epic 9).
 */
import type { Meta, StoryObj } from '@storybook/react-vite'
import { expect, within } from 'storybook/test'
import { Button } from '@/components/ui/button'
import { AppShell } from './AppShell'
import { BreadcrumbBar } from './BreadcrumbBar'
import { MobileTabBar } from './MobileTabBar'
import { SearchPill } from './SearchPill'
import { SidebarShell } from './SidebarShell'
import { TopbarShell } from './TopbarShell'
import { SIDEBAR_NAV_BY_ROLE } from './sidebarNavConfig'

const meta = {
  title: 'domain/AppShell',
  component: AppShell,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof AppShell>

export default meta
type Story = StoryObj<typeof meta>

function makeSidebar() {
  return (
    <SidebarShell
      role="owner"
      groups={SIDEBAR_NAV_BY_ROLE.owner}
      user={{ name: 'Jane Doe', avatarUrl: null }}
      activeHref="/dashboard"
    />
  )
}

function makeTopbar() {
  return (
    <TopbarShell
      breadcrumb={
        <BreadcrumbBar
          items={[
            { label: 'Workspace', href: '/' },
            { label: 'Classes' },
          ]}
        />
      }
      search={<SearchPill placeholderKey="topbar.search.placeholder" />}
      cta={<Button>+ New class</Button>}
    />
  )
}

function makeMobileTabBar() {
  return <MobileTabBar role="student" activeHref="/dashboard" unreadByTab={{ inbox: 3 }} />
}

export const Desktop: Story = {
  args: {
    sidebar: makeSidebar(),
    topbar: makeTopbar(),
    children: (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl text-foreground">Owner dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Desktop view — sidebar visible, mobile tab bar hidden.
        </p>
      </div>
    ),
    mobileTabBar: makeMobileTabBar(),
  },
}

/**
 * Mobile — iphone-14 viewport. SidebarShell is ABSENT from the DOM (not
 * CSS-hidden) per TEST-FE-6 + 1D-P0-020. Verified via
 * `queryByTestId('sidebar-nav-primary')` returning null.
 */
export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'iphone14' } },
  args: {
    sidebar: makeSidebar(),
    topbar: makeTopbar(),
    children: (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl text-foreground">Mobile dashboard</h1>
        <p className="text-sm text-muted-foreground">
          Mobile view — bottom tab bar visible, sidebar hidden.
        </p>
      </div>
    ),
    mobileTabBar: makeMobileTabBar(),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement)
    // Smoke check: the mobile tab bar mounts. The original className-regex
    // assertions ("does the rendered class string contain 'hidden md:flex'")
    // were tautological — they reread the source string instead of testing
    // runtime layout (1d-3 code-review P20). Real CSS-cascade verification
    // lives in `e2e/storybook/app-shell-mobile-viewport.spec.ts` which
    // measures `boundingBox()` at a real 375×667 viewport.
    await expect(canvas.getByTestId('mobile-tab-bar')).toBeInTheDocument()
  },
}

export const MobileWithBillingGrace: Story = {
  parameters: { viewport: { defaultViewport: 'iphone14' } },
  args: {
    sidebar: makeSidebar(),
    topbar: makeTopbar(),
    banner: (
      <div
        role="status"
        className="bg-destructive/10 px-4 py-2 text-xs text-destructive"
      >
        {/* Placeholder for Epic 9's BillingGraceBanner. */}
        Billing grace banner slot
      </div>
    ),
    children: (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl text-foreground">Mobile dashboard</h1>
      </div>
    ),
    mobileTabBar: makeMobileTabBar(),
  },
}

export const Tablet: Story = {
  parameters: { viewport: { defaultViewport: 'ipad' } },
  args: {
    sidebar: makeSidebar(),
    topbar: makeTopbar(),
    children: (
      <div className="space-y-4">
        <h1 className="font-heading text-2xl text-foreground">Tablet dashboard</h1>
      </div>
    ),
    mobileTabBar: makeMobileTabBar(),
  },
}
