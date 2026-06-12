/**
 * TopBar — 56px topbar with breadcrumb slot + search + language toggle.
 *
 * Story 1-7c ships visual chrome only. The real breadcrumb items are
 * supplied per-route by feature stories (route metadata or a Helmet-like
 * pattern). The SearchPill is a visual button — the ⌘K palette wiring
 * lives in a future story. The LanguageToggle is fully wired (AC6).
 *
 * Mobile hamburger toggle: a `md:hidden` button on the leading edge flips
 * `useUIStore.sidebarCollapsed`. Story 1d-3 can refactor this into the
 * role-aware mobile tab bar; until then, this is the only mutation surface
 * for the collapse state.
 */
import { useTranslation } from 'react-i18next'
import { useUIStore } from '@/stores/uiStore'
import LanguageToggle from './LanguageToggle'

export default function TopBar() {
  const { t } = useTranslation()
  const sidebarCollapsed = useUIStore((s) => s.sidebarCollapsed)
  const setSidebarCollapsed = useUIStore((s) => s.setSidebarCollapsed)

  return (
    <header
      role="banner"
      className="flex h-[var(--cl-topbar-height)] items-center justify-between border-b border-[var(--cl-line-soft)] bg-[var(--cl-surface)] px-4"
    >
      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t('app.layout.sidebar.collapseToggle')}
          aria-expanded={!sidebarCollapsed}
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-[var(--cl-radius-sm)] text-[var(--cl-ink-soft)] hover:bg-[var(--cl-chip-bg)]"
        >
          <span aria-hidden="true" className="text-lg">☰</span>
        </button>
        <nav
          aria-label={t('app.layout.topbar.breadcrumb')}
          className="flex items-center gap-2 text-sm text-[var(--cl-ink-soft)]"
        >
          {/* Breadcrumb items injected per-route in later stories. */}
        </nav>
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          aria-label={t('app.layout.topbar.search')}
          className="flex items-center gap-2 rounded-[var(--cl-radius-full)] border border-[var(--cl-line)] bg-[var(--cl-surface)] px-3 py-1.5 text-sm text-[var(--cl-ink-soft)]"
        >
          <span>{t('app.layout.topbar.search')}</span>
          <span
            aria-label={t('app.layout.topbar.searchHint')}
            className="rounded-[var(--cl-radius-sm)] bg-[var(--cl-chip-bg)] px-1.5 py-0.5 font-[var(--cl-font-mono)] text-xs text-[var(--cl-ink)]"
          >
            ⌘K
          </span>
        </button>

        <LanguageToggle />
      </div>
    </header>
  )
}
