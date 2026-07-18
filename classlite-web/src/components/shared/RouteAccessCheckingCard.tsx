/**
 * RouteAccessCheckingCard — Story 2.6 (AC5, Sally-BLOCKER-1 amendment).
 *
 * The default `loadingFallback` for `<RouteRoleGate>` while `useRoleLoading()`
 * is true (boot probe in flight OR session hydrated without a role yet).
 * Renders a centered card with a spinner and "Checking access..." copy in
 * native VN + EN so the UX-1 loading trilogy stays consistent — no bare
 * `<div aria-hidden />` gaps that read like a broken page.
 *
 * Root is a plain in-flow `<div>`, NOT a `<main>`: RouteRoleGate mounts this
 * in the Outlet position under AppShell's `<main id="main-content">`, so a
 * nested `<main role="main">` would trip axe `landmark-unique` and paint a
 * full-viewport block inside the already-chromed shell.
 */
import { useTranslation } from 'react-i18next'
import { Loader2 } from 'lucide-react'

export function RouteAccessCheckingCard() {
  const { t } = useTranslation()
  return (
    <div
      data-testid="route-role-gate-checking"
      aria-live="polite"
      aria-busy="true"
      className="flex min-h-[50vh] w-full flex-col items-center justify-center px-4 text-center"
    >
      <div className="flex flex-col items-center gap-3 rounded-lg border border-[var(--cl-border)] bg-[var(--cl-surface)] px-8 py-6 shadow-sm">
        <Loader2
          aria-hidden="true"
          className="size-6 animate-spin text-[var(--cl-accent)]"
        />
        <p className="font-[var(--cl-font-body)] text-sm text-[var(--cl-ink-soft)]">
          {t('app.routeGate.checkingAccess')}
        </p>
      </div>
    </div>
  )
}
