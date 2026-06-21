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
 * the role from the authenticated user. Until then, every consuming route is
 * still under the "Story 1-7c placeholder routes" comment in `routes.tsx`
 * and renders the guest shell.
 *
 * Single uiStore subscription discipline (Winston, party-mode 2026-06-18):
 * AppLayout is the SOLE consumer of `useUIStore((s) => s.sidebarCollapsed)`
 * in the dev-shell scope. `AppShell` / `SidebarShell` receive the boolean
 * via the `collapsed` prop; re-subscribing inside the domain stack causes
 * double renders that React DevTools shows but the test suite misses.
 */
import { useEffect } from 'react'
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import { useRole } from '@/hooks/useRole'
import { AppShell } from '@/components/domain/AppShell'
import { BreadcrumbBar } from '@/components/domain/BreadcrumbBar'
import { MobileTabBar } from '@/components/domain/MobileTabBar'
import { SearchPill } from '@/components/domain/SearchPill'
import { SidebarShell } from '@/components/domain/SidebarShell'
import { SIDEBAR_NAV_BY_ROLE } from '@/components/domain/sidebarNavConfig'
import { TopbarShell } from '@/components/domain/TopbarShell'
import LanguageToggle from './LanguageToggle'

export default function AppLayout() {
  const { t } = useTranslation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const role = useRole()

  useEffect(() => {
    if (role === null && import.meta.env.DEV) {
      // Dev-only hint. React strict-mode runs effects twice; two warns are
      // acceptable in exchange for the safety guarantee.

      console.warn(
        '[AppLayout] No session role resolved — rendering guest shell ' +
          '(topbar only, no nav). Wrap your route under a `RoleProvider` ' +
          "or wait for Story 1-8's auth wiring to see role-aware chrome.",
      )
    }
  }, [role])

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
              user={{ name: t(`userPill.role.${role}`), avatarUrl: null }}
              activeHref="/dashboard"
              collapsed={sidebarCollapsed}
            />
          ) : null
        }
        topbar={
          <TopbarShell
            breadcrumb={<BreadcrumbBar items={[]} />}
            search={<SearchPill placeholderKey="topbar.search.placeholder" />}
            cta={<LanguageToggle />}
          />
        }
        mobileTabBar={
          role !== null ? <MobileTabBar role={role} activeHref="/dashboard" /> : null
        }
      >
        <Outlet />
      </AppShell>
    </>
  )
}
