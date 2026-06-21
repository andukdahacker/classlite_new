import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { Role } from '@/hooks/useRole'
import { SidebarNavItem } from './SidebarNavItem'
import { UserPill } from './UserPill'

/**
 * SidebarShell — `s06` 220px sidebar with four role variants.
 *
 * The `role` prop selects the variant; the consumer supplies the per-role
 * `groups` array (default sets per role live in `sidebarNavConfig.tsx`).
 * Per-role nav sets match `classlite-ia.md` lines 16–19 EXACTLY — re-read
 * the IA before changing.
 *
 * NOT a `uiStore` consumer. Per the single-subscription discipline
 * (Winston, party-mode 2026-06-18), `AppShell` is the SOLE consumer of
 * `useUIStore((s) => s.sidebarCollapsed)`. `SidebarShell` receives the
 * boolean via the `collapsed` prop — re-subscribing here causes double
 * renders that React DevTools shows but the test suite misses.
 */

export interface SidebarNavItemConfig {
  /** i18n key for the visible label. */
  labelKey: string
  icon: ReactNode
  href: string
  /** Unread/notification count, or null when none. */
  badgeCount?: number
}

export interface SidebarNavGroup {
  /** Optional group label; when omitted the items render flush without separator. */
  labelKey?: string
  items: ReadonlyArray<SidebarNavItemConfig>
}

export interface SidebarShellProps {
  role: Role
  /** Top-to-bottom group ordering owned by the consumer. */
  groups: ReadonlyArray<SidebarNavGroup>
  /** UserPill data — rendered at sidebar foot. */
  user: { name: string; avatarUrl?: string | null }
  /** Active href for highlighting; consumer derives from router match. */
  activeHref: string
  /**
   * Collapsed UI state. Prop-drilled from `AppShell` / `AppLayout` —
   * `AppShell` is the SOLE consumer of `useUIStore((s) => s.sidebarCollapsed)`.
   * Do NOT subscribe to `uiStore` inside this component or its
   * descendants; double-subscription causes double renders that React
   * DevTools shows but the test suite misses (Winston, party-mode
   * 2026-06-18). Single-subscription discipline.
   */
  collapsed?: boolean
  onCollapseToggle?: () => void
}

export function SidebarShell({
  role,
  groups,
  user,
  activeHref,
  collapsed,
}: SidebarShellProps) {
  const { t } = useTranslation()

  return (
    <aside
      data-testid="sidebar-nav-primary"
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label={t('sidebar.brand')}
      className={cn(
        'hidden md:flex h-screen w-[220px] shrink-0 flex-col bg-sidebar text-sidebar-foreground',
        collapsed && 'md:hidden',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-5">
        <span
          aria-hidden="true"
          className="inline-block size-2 rounded-full bg-sidebar-primary"
        />
        <span className="font-heading text-lg italic text-sidebar-primary">
          {t('sidebar.brand')}
        </span>
      </div>

      <nav
        aria-label={t('sidebar.nav.primary')}
        className="flex-1 overflow-y-auto px-2"
      >
        {groups.map((group, groupIndex) => {
          const groupLabelId = group.labelKey
            ? `sidebar-group-${groupIndex}-${group.labelKey.replace(/\./g, '-')}`
            : undefined
          return (
            <section
              key={group.labelKey ?? `group-${groupIndex}`}
              aria-labelledby={groupLabelId}
              className={cn(
                'space-y-1 py-2',
                groupIndex > 0 && 'mt-2 border-t border-sidebar-border pt-3',
              )}
            >
              {group.labelKey && groupLabelId ? (
                <h3
                  id={groupLabelId}
                  className="px-3 text-xs font-medium tracking-wide text-sidebar-foreground/70"
                >
                  {t(group.labelKey)}
                </h3>
              ) : null}
              <ul className="space-y-1">
                {group.items.map((item) => (
                  <li key={item.href}>
                    <SidebarNavItem
                      labelKey={item.labelKey}
                      icon={item.icon}
                      href={item.href}
                      active={item.href === activeHref}
                      badgeCount={item.badgeCount}
                    />
                  </li>
                ))}
              </ul>
            </section>
          )
        })}
      </nav>

      <div className="border-t border-sidebar-border px-2 py-3">
        <UserPill name={user.name} avatarUrl={user.avatarUrl ?? null} role={role} />
      </div>
    </aside>
  )
}
