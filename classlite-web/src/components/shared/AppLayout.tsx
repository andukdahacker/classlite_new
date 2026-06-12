/**
 * AppLayout — root shell wrapping every authenticated page.
 *
 * Composes Sidebar + TopBar + a `<main id="main-content" role="main">`
 * region hosting `<Outlet />`. The skip-to-content link is the FIRST
 * focusable DOM element so keyboard users can bypass the sidebar nav
 * (WCAG 2.4.1 — verified by AppLayout.test.tsx + bilingual-smoke.spec.ts).
 *
 * AppLayout does NOT fetch data — Loading / Empty / Error trilogy
 * (project-context TEST-FE-2) applies to data-fetching components inside
 * the layout, not to the layout itself.
 *
 * Today no route mounts AppLayout — the placeholder routes from 1-7b
 * (`/student`, `/dashboard`) render single-heading stubs without the
 * shell. Story 1-8 onwards mount this layout via React Router v7
 * pathless layout routes once the auth UI lands. This story ships
 * the component + the test + the i18n keys; route mounting is
 * downstream.
 */
import { Outlet } from 'react-router'
import { useTranslation } from 'react-i18next'
import Sidebar from './Sidebar'
import TopBar from './TopBar'

export default function AppLayout() {
  const { t } = useTranslation()

  return (
    <div className="flex min-h-screen bg-[var(--cl-paper)]">
      <a
        href="#main-content"
        className="sr-only fixed top-2 left-2 z-50 rounded-[var(--cl-radius-sm)] bg-[var(--cl-ink)] px-3 py-2 text-sm text-[var(--cl-surface)] focus:not-sr-only"
      >
        {t('app.layout.skipToContent')}
      </a>

      <Sidebar />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main
          id="main-content"
          role="main"
          tabIndex={-1}
          className="flex-1 overflow-auto p-6"
        >
          <Outlet />
        </main>
      </div>
    </div>
  )
}
