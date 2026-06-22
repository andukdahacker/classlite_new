import type { ReactNode } from 'react'

/**
 * AppShell — top-level layout. `s06` for every desktop screen, mobile
 * frame for `s74–s86`.
 *
 * Three-slot layout: `sidebar` slot (220px desktop sidebar, absent below
 * `md`), `topbar` slot (every screen), `children` (main content). Optional
 * `banner` slot for the deferred `BillingGraceBanner` (Epic 9). Optional
 * `mobileTabBar` slot for the bottom tab bar (visible only below `md` via
 * Tailwind responsive utility on the component itself).
 *
 * Single uiStore subscription discipline (Winston, party-mode 2026-06-18).
 * If consumers want a collapsible sidebar, `AppShell` is the SOLE place
 * that calls `useUIStore((s) => s.sidebarCollapsed)`. The boolean
 * prop-drills down to `SidebarShell.collapsed` (already declared in its
 * Props). `SidebarShell` MUST NOT re-subscribe to `uiStore` — double
 * subscription causes double renders that React DevTools shows but the
 * test suite misses.
 */
export interface AppShellProps {
  sidebar: ReactNode
  topbar: ReactNode
  children: ReactNode
  /** Optional banner slot used by `BillingGraceBanner` (deferred to Epic 9). When set, banner renders above `topbar`. */
  banner?: ReactNode
  /** Mobile bottom tab bar (`MobileTabBar`). Rendered only below `md` via its own responsive class. */
  mobileTabBar?: ReactNode
}

export function AppShell({
  sidebar,
  topbar,
  children,
  banner,
  mobileTabBar,
}: AppShellProps) {
  return (
    <div
      data-testid="app-shell-root"
      className="flex min-h-screen bg-background text-foreground"
    >
      {sidebar}

      <div className="flex min-w-0 flex-1 flex-col">
        {banner ? <div data-testid="app-shell-banner">{banner}</div> : null}
        {topbar}
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          // Reserve 96px at the bottom on mobile ONLY when a tab bar is
          // mounted. Guest shell (no tab bar) gets the default 24px,
          // otherwise we'd ship a dead 96px gap below content.
          className={
            mobileTabBar
              ? 'flex-1 overflow-auto p-6 pb-24 md:pb-6'
              : 'flex-1 overflow-auto p-6'
          }
        >
          {children}
        </main>
      </div>

      {mobileTabBar}
    </div>
  )
}
