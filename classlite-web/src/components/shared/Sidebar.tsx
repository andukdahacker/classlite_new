/**
 * Sidebar — non-variant navy sidebar (1-7c placeholder).
 *
 * Story 1-7c ships a single placeholder sidebar that wraps the
 * brand wordmark + a generic three-group nav + the UserPill at the
 * foot. The full role-variant Sidebar (Owner / Admin / Teacher /
 * Student per UX spec §4.1) lives in Epic 1D Story 1d-3 with
 * Storybook coverage. 1d-3 will refactor this shell to consume the
 * role-aware SidebarShell from `components/domain/` when it lands.
 *
 * Mobile behavior: collapses off-canvas via `useUIStore` selector.
 * The collapsed state is module-level (persists across route changes)
 * but does NOT persist across reloads (no cookie / storage write — UI
 * state only per project-context FW-5).
 */
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import UserPill from './UserPill'

const SIDEBAR_BASE_CLASSES =
  'fixed top-0 left-0 z-30 flex h-screen w-[var(--cl-sidebar-width)] flex-col bg-[var(--cl-sidebar-bg)] text-[var(--cl-sidebar-text)] transition-transform md:relative md:translate-x-0'

export default function Sidebar() {
  const { t } = useTranslation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)

  return (
    <aside
      aria-label={t('app.layout.sidebar.brand')}
      data-collapsed={sidebarCollapsed}
      className={
        sidebarCollapsed
          ? `-translate-x-full ${SIDEBAR_BASE_CLASSES}`
          : SIDEBAR_BASE_CLASSES
      }
    >
      <div className="flex items-center gap-2 px-4 py-5">
        <span
          aria-hidden="true"
          className="inline-block h-2 w-2 rounded-[var(--cl-radius-full)] bg-[var(--cl-accent-2)]"
        />
        <span className="font-[var(--cl-font-display)] text-lg italic text-[var(--cl-sidebar-active-bg)]">
          {t('app.layout.sidebar.brand')}
        </span>
      </div>

      <nav
        aria-label={t('app.layout.sidebar.nav.aria')}
        className="flex-1 px-2"
      >
        <ul className="space-y-1">
          <li>
            <a
              href="/dashboard"
              className="block rounded-[var(--cl-radius-sm)] px-3 py-2 text-sm hover:bg-[var(--cl-sidebar-hover)]"
            >
              {t('app.welcome')}
            </a>
          </li>
        </ul>
      </nav>

      <div className="px-2 py-3">
        <UserPill />
      </div>
    </aside>
  )
}
