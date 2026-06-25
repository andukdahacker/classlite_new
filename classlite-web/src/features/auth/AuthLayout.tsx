/**
 * AuthLayout — root of the auth lazy bundle group, enriched per Story
 * 1-8 AC6.
 *
 * Pre-auth pages (login, register, forgot password, reset password,
 * email verification, invite acceptance) mount as children of this
 * layout. The router lazy-loads AuthLayout as the auth chunk entry, so
 * Rolldown emits a single bundle for the whole auth surface that the
 * student/teacher dashboards never pull in.
 *
 * Visual additions (Story 1-8):
 *   - ClassLite wordmark (Fraunces 22px italic + amber dot per UX-DR5)
 *     in the top navigation row
 *   - LanguageToggle (UX-DR17) on the right
 *     * Desktop (`md:` and up) — full segmented EN/VI control
 *     * Mobile — 32×32 icon-only collapsed button (globe + 2-letter
 *       active locale chip overlaid); tap expands to the full segmented
 *       control (Sally amendment 2026-06-25, locked)
 *   - `<Outlet />` renders centered horizontally + vertically in the
 *     remaining viewport height
 *
 * The background pattern is NOT applied here — the global body
 * style at `src/index.css:121` already paints it. Re-applying it
 * inside AuthLayout would double-render the pattern. AC6 DoD grep
 * (run from Task 13.1) enforces this rule.
 */
import { useEffect, useRef, useState } from 'react'
import { Outlet } from 'react-router'
import { GlobeIcon } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import LanguageToggle from '@/components/shared/LanguageToggle'
import { useLanguageStore } from '@/stores/languageStore'
import { cn } from '@/lib/utils'

function MobileLanguageToggle() {
  const { t } = useTranslation()
  const language = useLanguageStore((s) => s.language)
  const [expanded, setExpanded] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // Click / tap outside collapses the expanded control. Implemented with
  // `useEffect` because the listener target is `document`, not React-
  // managed DOM (project-context FW-4 permits useEffect for DOM
  // imperative ops). Both `mousedown` AND `touchstart` are registered
  // (P7 amendment 2026-06-25) — `mousedown` alone broke tap-to-collapse
  // on iOS Safari, which is the platform this mobile-only control
  // primarily targets. Using `pointerdown` would cover both in one
  // listener but its event ordering relative to focus + click handlers
  // has cross-browser quirks; the pair is the safer pattern.
  useEffect(() => {
    if (!expanded) return
    const handler = (event: MouseEvent | TouchEvent) => {
      const target = event.target
      if (
        containerRef.current &&
        target instanceof Node &&
        !containerRef.current.contains(target)
      ) {
        setExpanded(false)
      }
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('touchstart', handler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('touchstart', handler)
    }
  }, [expanded])

  return (
    <div ref={containerRef} data-slot="mobile-language-toggle">
      {expanded ? (
        <LanguageToggle />
      ) : (
        <button
          type="button"
          aria-label={t('app.layout.languageToggle.aria')}
          aria-expanded={false}
          data-testid="mobile-language-collapsed"
          onClick={() => setExpanded(true)}
          className="relative grid size-8 place-items-center rounded-full border border-[var(--cl-line)] bg-[var(--cl-surface)] text-[var(--cl-ink-soft)]"
        >
          <GlobeIcon aria-hidden="true" className="size-4" />
          <span
            aria-hidden="true"
            className="absolute -bottom-1 -right-1 rounded-full bg-[var(--cl-ink)] px-1 text-[10px] font-medium text-[var(--cl-surface)]"
          >
            {language === 'vi'
              ? t('app.layout.languageToggle.vi')
              : t('app.layout.languageToggle.en')}
          </span>
        </button>
      )}
    </div>
  )
}

export default function AuthLayout() {
  const { t } = useTranslation()
  return (
    <main className={cn('flex min-h-screen flex-col')}>
      <header
        data-slot="auth-layout-header"
        className="flex items-center justify-between px-5 py-4 sm:px-8"
      >
        <a
          href="/"
          aria-label={t('sidebar.brand')}
          data-testid="auth-layout-wordmark"
          className="inline-flex items-baseline gap-1 font-[var(--cl-font-display)] text-[22px] italic text-[var(--cl-ink)]"
        >
          <span>ClassLite</span>
          <span
            aria-hidden="true"
            className="inline-block size-1.5 rounded-full bg-[var(--cl-accent)]"
          />
        </a>
        <div data-testid="auth-layout-language-toggle">
          <div className="hidden md:block">
            <LanguageToggle />
          </div>
          <div className="md:hidden">
            <MobileLanguageToggle />
          </div>
        </div>
      </header>
      <div className="flex flex-1 items-center justify-center px-5 py-6">
        <Outlet />
      </div>
    </main>
  )
}
