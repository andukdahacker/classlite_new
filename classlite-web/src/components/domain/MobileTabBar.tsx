import {
  BarChart3,
  BookOpen,
  CalendarDays,
  ClipboardList,
  Home,
  Inbox,
  UserCircle,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Role } from '@/hooks/useRole'
import { MobileTab } from './MobileTab'

/**
 * MobileTabBar — purpose-designed mobile bottom tab bar (`s74–s86`).
 *
 * NOT a responsive squish of `SidebarShell` (UX-4 + UX-DR32). Renders 5
 * tabs per role per the IA mobile Chapter 8 spec; sub-component
 * `MobileTab` per cell. Touch-target ≥44×44px (TEST-UX-4 / 1D-P1-105..108).
 *
 * UX-3 exception (closed 2026-06-18 by Ducdo: AC7.a). Role-to-tabs is a
 * LAYOUT decision matched to IA Chapter 8 — NOT a permission decision.
 * UX-DR29 role-variant Storybook lint at the story-author level catches
 * any future attempt to use this pattern for permission gating. The
 * precedent risk is bounded by UX-DR29 enforcement.
 *
 * `useRole()` null guard (Amelia, party-mode 2026-06-18). Production
 * unauthenticated baseline returns `Role | null`. When `role` is null
 * (consumer mounted `MobileTabBar` without an auth wrapper), render
 * nothing — an `AppShell` mounted without auth has no meaningful mobile
 * tab set.
 *
 * Focus management on route activation (Murat, party-mode 2026-06-18).
 * `onTabActivate` is the consumer hook for moving focus to the page `<h1>`
 * (or skip-to-content target) AFTER navigation — `MobileTabBar` ships the
 * contract via JSDoc; the actual focus move lives in the route layer
 * (Stories 1-8 / 2-x mount this and own the focus handler). `aria-live`
 * on the H1 announces the new page title to screen readers.
 *
 * Admin mobile shares the Owner mobile set per the IA convention (IA
 * Chapter 8 doesn't draw Admin mobile — `s86` is Owner-only push approval).
 */
export interface MobileTabBarProps {
  role: Role | null
  /** Active href derived by consumer from router match. */
  activeHref: string
  /**
   * Tab activation handler. Receives the new href. Default no-op.
   *
   * Consumer responsibility: AFTER navigation, move focus to `<h1>` (or
   * the skip-to-content target) so screen-reader users get a page-change
   * announcement; `aria-live="polite"` on the H1 announces the new title.
   * `MobileTabBar` ships the contract here; the focus move itself lives
   * in the route layer.
   */
  onTabActivate?: (href: string) => void
  /** Optional per-role unread map keyed by tab `testIdSlug`. */
  unreadByTab?: Partial<Record<string, boolean | number>>
}

interface TabConfig {
  labelKey: string
  icon: LucideIcon
  href: string
  testIdSlug: string
}

/**
 * Per-role tab sets sourced from `classlite-ia.md` Chapter 8 mobile sections
 * (lines 213–249). Owner+Admin tabs are extrapolated from desktop priority —
 * see story-file `@status: extrapolated-pending-design-review` on `OwnerView`.
 */
const STUDENT_TABS: ReadonlyArray<TabConfig> = [
  { labelKey: 'mobileTab.student.home', icon: Home, href: '/dashboard', testIdSlug: 'home' },
  { labelKey: 'mobileTab.student.assignments', icon: ClipboardList, href: '/assignments', testIdSlug: 'assignments' },
  { labelKey: 'mobileTab.student.inbox', icon: Inbox, href: '/inbox', testIdSlug: 'inbox' },
  { labelKey: 'mobileTab.student.classes', icon: BookOpen, href: '/my-classes', testIdSlug: 'classes' },
  { labelKey: 'mobileTab.student.me', icon: UserCircle, href: '/profile', testIdSlug: 'me' },
]

const TEACHER_TABS: ReadonlyArray<TabConfig> = [
  { labelKey: 'mobileTab.teacher.home', icon: Home, href: '/dashboard', testIdSlug: 'home' },
  { labelKey: 'mobileTab.teacher.classes', icon: BookOpen, href: '/classes', testIdSlug: 'classes' },
  { labelKey: 'mobileTab.teacher.inbox', icon: Inbox, href: '/inbox', testIdSlug: 'inbox' },
  { labelKey: 'mobileTab.teacher.schedule', icon: CalendarDays, href: '/schedule', testIdSlug: 'schedule' },
  { labelKey: 'mobileTab.teacher.me', icon: UserCircle, href: '/profile', testIdSlug: 'me' },
]

const OWNER_TABS: ReadonlyArray<TabConfig> = [
  { labelKey: 'mobileTab.owner.home', icon: Home, href: '/dashboard', testIdSlug: 'home' },
  { labelKey: 'mobileTab.owner.people', icon: Users, href: '/people/staff', testIdSlug: 'people' },
  { labelKey: 'mobileTab.owner.inbox', icon: Inbox, href: '/inbox', testIdSlug: 'inbox' },
  { labelKey: 'mobileTab.owner.analytics', icon: BarChart3, href: '/analytics', testIdSlug: 'analytics' },
  { labelKey: 'mobileTab.owner.me', icon: UserCircle, href: '/profile', testIdSlug: 'me' },
]

function tabsForRole(role: Role | null): ReadonlyArray<TabConfig> {
  switch (role) {
    case 'student':
      return STUDENT_TABS
    case 'teacher':
      return TEACHER_TABS
    case 'owner':
    case 'admin':
      // Admin shares Owner mobile per IA Chapter 8 convention (Admin mobile
      // not drawn in IA; Owner mobile is the canonical extrapolation).
      return OWNER_TABS
    default:
      return []
  }
}

export function MobileTabBar({
  role,
  activeHref,
  onTabActivate,
  unreadByTab,
}: MobileTabBarProps) {
  const { t } = useTranslation()
  const tabs = tabsForRole(role)
  if (tabs.length === 0) return null

  return (
    <nav
      data-testid="mobile-tab-bar"
      aria-label={t('mobileTab.nav.primary')}
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card md:hidden"
    >
      {tabs.map((tab) => (
        <MobileTab
          key={tab.testIdSlug}
          labelKey={tab.labelKey}
          icon={<tab.icon className="size-5" />}
          href={tab.href}
          active={tab.href === activeHref}
          hasUnread={unreadByTab?.[tab.testIdSlug]}
          testIdSlug={tab.testIdSlug}
          onActivate={onTabActivate}
        />
      ))}
    </nav>
  )
}
