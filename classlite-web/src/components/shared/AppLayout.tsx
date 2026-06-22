/**
 * AppLayout — root shell wrapping every authenticated page.
 *
 * Story 1d-3 refactored AppLayout to consume the canonical role-aware
 * components from `@/components/domain/`. The 1-7c placeholders (Sidebar /
 * TopBar / UserPill that lived in `components/shared/`) are RETIRED. The
 * skip-to-content link is preserved here at the AppLayout level so it
 * remains the FIRST focusable DOM element (WCAG 2.4.1 — verified by
 * `AppLayout.test.tsx` + `bilingual-smoke.spec.ts`).
 *
 * Role resolution + LEAST-PRIVILEGE DEFAULT (Story 1d-3 party-mode review,
 * 2026-06-21, Winston). AppLayout reads from `useRole()` (returns `Role |
 * null`). The original 1d-3 implementation defaulted `role='owner'` when
 * `null` — Winston flagged this as a privilege-direction footgun: defaults
 * should be LEAST-privileged, not MOST. "Dev shell" defaults have a habit
 * of leaking into prod, and `'owner'` is the highest-privilege role in the
 * multi-tenant model. Replaced with:
 *
 *   - `role` is non-null → render the role-aware sidebar + mobile tab bar.
 *   - `role` is null → render a "guest shell": topbar + main content only.
 *     No sidebar nav, no mobile tab bar, no UserPill. The user sees the
 *     chrome but has no nav surface. Clearly degraded, clearly intentional.
 *     In DEV, a `console.warn` makes the degradation visible to developers
 *     so they can wire `RoleProvider` in their setup or wait for Story 1-8
 *     to land the real auth flow.
 *
 * Story 1-8 onwards mounts AppLayout under a real auth wrapper that resolves
 * the role + display name from the authenticated user. Until then, every
 * consuming route is still under the "Story 1-7c placeholder routes" comment
 * in `routes.tsx` and renders the guest shell.
 *
 * Single uiStore subscription discipline (Winston, party-mode 2026-06-18):
 * AppLayout is the SOLE consumer of `useUIStore` — both `sidebarCollapsed`
 * and `setSidebarCollapsed`. `AppShell` / `SidebarShell` receive the boolean
 * via the `collapsed` prop; `TopbarShell` receives the hamburger as a
 * `collapseToggle` slot. Re-subscribing inside the domain stack causes
 * double renders that React DevTools shows but the test suite misses.
 *
 * Active-route highlighting (1d-3 code-review D6 + P1). Sidebar
 * `activeHref` is resolved by longest-prefix-matching `location.pathname`
 * against every href in the role's nav config. Deep routes like
 * `/classes/123` highlight the `/classes` tab; `/classes-archived` does
 * NOT collide with `/classes`. `MobileTabBar` receives raw
 * `location.pathname` and does the same match internally against its own
 * tab set.
 */
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router'
import { useTranslation } from 'react-i18next'
import { Menu } from 'lucide-react'
import { useUIStore } from '@/stores/uiStore'
import { useRole, type Role } from '@/hooks/useRole'
import { matchLongestHrefPrefix } from '@/lib/match-route'
import { AppShell } from '@/components/domain/AppShell'
import { BreadcrumbBar } from '@/components/domain/BreadcrumbBar'
import { MobileTabBar } from '@/components/domain/MobileTabBar'
import { SearchPill } from '@/components/domain/SearchPill'
import { SidebarShell } from '@/components/domain/SidebarShell'
import { SIDEBAR_NAV_BY_ROLE } from '@/components/domain/sidebarNavConfig'
import { TopbarShell } from '@/components/domain/TopbarShell'
import { Button } from '@/components/ui/button'
import { warnIfFirstNoRoleResolution } from './AppLayout-warn-tracking'
import LanguageToggle from './LanguageToggle'

function sidebarHrefs(role: Role): readonly string[] {
  return SIDEBAR_NAV_BY_ROLE[role].flatMap((group) =>
    group.items.map((item) => item.href),
  )
}

export default function AppLayout() {
  const { t } = useTranslation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)
  const role = useRole()
  const location = useLocation()

  useEffect(() => {
    if (role === null && import.meta.env.DEV) {
      warnIfFirstNoRoleResolution(
        '[AppLayout] No session role resolved — rendering guest shell ' +
          '(topbar only, no nav). Wrap your route under a `RoleProvider` ' +
          "or wait for Story 1-8's auth wiring to see role-aware chrome.",
      )
    }
  }, [role])

  const sidebarActiveHref =
    role !== null
      ? (matchLongestHrefPrefix(location.pathname, sidebarHrefs(role)) ?? location.pathname)
      : location.pathname

  const collapseToggle = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t(
        sidebarCollapsed ? 'topbar.sidebarToggle.expand' : 'topbar.sidebarToggle.collapse',
      )}
      aria-pressed={sidebarCollapsed}
      data-testid="sidebar-collapse-toggle"
      onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
    >
      <Menu aria-hidden="true" className="size-5" />
    </Button>
  )

  return (
    <>
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-50 rounded bg-foreground px-3 py-2 text-sm text-background focus:not-sr-only"
      >
        {t('app.layout.skipToContent')}
      </a>
      <AppShell
        sidebar={
          role !== null ? (
            <SidebarShell
              role={role}
              groups={SIDEBAR_NAV_BY_ROLE[role]}
              // TODO(1-8): replace `t(userPill.role.${role})` with the
              // authenticated user's display name from the auth wrapper.
              // Until then, every dev user sees their role label as the
              // user name (Owner shows "Owner / Owner") — clearly a
              // placeholder, not a leak.
              user={{ name: t(`userPill.role.${role}`), avatarUrl: null }}
              activeHref={sidebarActiveHref}
              collapsed={sidebarCollapsed}
            />
          ) : null
        }
        topbar={
          <TopbarShell
            breadcrumb={<BreadcrumbBar items={[]} />}
            search={<SearchPill placeholderKey="topbar.search.placeholder" />}
            cta={<LanguageToggle />}
            collapseToggle={role !== null ? collapseToggle : null}
          />
        }
        mobileTabBar={
          role !== null ? (
            <MobileTabBar role={role} activeHref={location.pathname} />
          ) : null
        }
      >
        <Outlet />
      </AppShell>
    </>
  )
}
