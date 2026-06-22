import { useEffect } from 'react'
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
import { useLocation } from 'react-router'
import type { Role } from '@/hooks/useRole'
import { matchLongestHrefPrefix } from '@/lib/match-route'
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
 * The guardrail is documented convention only, NOT enforced lint
 * (1d-3 code-review P6 / party-mode #13): UX-DR29 lint is deferred
 * until a real role-as-permission misuse appears — premature lint
 * would block legitimate role-variant layout patterns elsewhere.
 *
 * `useRole()` null guard (Amelia, party-mode 2026-06-18). Production
 * unauthenticated baseline returns `Role | null`. When `role` is null
 * (consumer mounted `MobileTabBar` without an auth wrapper), render
 * nothing — an `AppShell` mounted without auth has no meaningful mobile
 * tab set.
 *
 * Focus management on route activation (1d-3 code-review D4). The
 * contract is owned INTERNALLY: a `useEffect` keyed on
 * `useLocation().pathname` moves focus to `#main-content` after
 * navigation paints. The previous design exposed `onTabActivate` as the
 * focus hook for consumers, but `onClick` fires BEFORE React Router
 * updates `location.pathname` so the consumer could never see the new
 * page — the contract was unimplementable as documented. `onTabActivate`
 * is preserved as an optional side-effect callback (analytics,
 * instrumentation) and is NOT load-bearing for accessibility. The
 * `PageHead.<h1>` carries `tabIndex={-1}` so consumers wanting H1-level
 * focus can override the effect; default behavior focuses the `<main>`
 * landmark which is sufficient for SR page-change announcements.
 *
 * Active-tab matching uses longest-prefix (1d-3 code-review D6) — a
 * deep route like `/classes/123` highlights the `/classes` tab, but
 * `/classes-archived` does NOT match `/classes`. Root `/` matches only
 * itself, never every sub-path.
 *
 * Admin mobile shares the Owner mobile set per the IA convention (IA
 * Chapter 8 doesn't draw Admin mobile — `s86` is Owner-only push approval).
 */
export interface MobileTabBarProps {
  role: Role | null
  /**
   * Raw current pathname (from `useLocation().pathname` in the consumer).
   * MobileTabBar resolves the active tab via longest-prefix match across
   * its own tab set — consumers do NOT pre-match.
   */
  activeHref: string
  /**
   * Optional side-effect callback fired on tab click. Receives the
   * target href. NOT load-bearing for accessibility — internal focus
   * management runs regardless. Use for analytics / instrumentation.
   */
  onTabActivate?: (href: string) => void
  /**
   * Optional per-role unread map keyed by tab `testIdSlug`. In DEV,
   * unknown slugs (typos, stale keys) trigger a `console.warn` so
   * silent-no-badge bugs surface during development.
   */
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
  const location = useLocation()
  const tabs = tabsForRole(role)

  // Focus the `<main>` landmark after every navigation so screen-reader
  // users get a page-change announcement. Runs regardless of which tab
  // (or no tab) initiated the nav — consumer-driven navigations get the
  // same treatment as tab clicks.
  useEffect(() => {
    if (tabs.length === 0) return
    const main = document.getElementById('main-content')
    main?.focus({ preventScroll: true })
  }, [location.pathname, tabs.length])

  // DEV-only typo guard for `unreadByTab` keys. Production users get a
  // silent no-badge fallback; developers catch the bug at runtime.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    if (!unreadByTab) return
    const slugs = new Set(tabs.map((tab) => tab.testIdSlug))
    const unknown = Object.keys(unreadByTab).filter((key) => !slugs.has(key))
    if (unknown.length > 0) {
      console.warn(
        '[MobileTabBar] unreadByTab contains slug(s) not in the active role\'s tab set — typo or stale key:',
        unknown,
        '— known slugs:',
        Array.from(slugs),
      )
    }
  }, [tabs, unreadByTab])

  if (tabs.length === 0) return null

  const hrefs = tabs.map((tab) => tab.href)
  const matchedHref = matchLongestHrefPrefix(activeHref, hrefs)

  return (
    <nav
      data-testid="mobile-tab-bar"
      aria-label={t('mobileTab.nav.primary')}
      // `pb-[env(safe-area-inset-bottom)]` keeps the bottom tabs above
      // the iOS home indicator on devices that report a non-zero
      // safe-area inset. Browsers without the inset return 0px — the
      // utility is a no-op there.
      className="fixed bottom-0 left-0 right-0 z-40 flex border-t border-border bg-card pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      {tabs.map((tab) => (
        <MobileTab
          key={tab.testIdSlug}
          labelKey={tab.labelKey}
          icon={<tab.icon className="size-5" />}
          href={tab.href}
          active={tab.href === matchedHref}
          hasUnread={unreadByTab?.[tab.testIdSlug]}
          testIdSlug={tab.testIdSlug}
          onActivate={onTabActivate}
        />
      ))}
    </nav>
  )
}
