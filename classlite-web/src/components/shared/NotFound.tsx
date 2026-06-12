/**
 * NotFound — localized 404 catch-all screen (Story 1-7c AC5).
 *
 * Mounted via the `path: '*'` lazy route at the end of `baseRoutes` in
 * `routes.tsx`. Closes the deferred catch-all from 1-7b's W1 finding —
 * before this, an unknown path landed on React Router's default error
 * UI which bypassed the i18n boundary.
 */
import { useTranslation } from 'react-i18next'

export default function NotFound() {
  const { t } = useTranslation()
  return (
    <main
      role="main"
      className="flex min-h-screen flex-col items-center justify-center bg-[var(--cl-paper)] px-4 text-center"
    >
      <h1 className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]">
        {t('app.notFound.title')}
      </h1>
      <p className="mt-3 max-w-md font-[var(--cl-font-body)] text-[var(--cl-ink-soft)]">
        {t('app.notFound.body')}
      </p>
      <a
        href="/dashboard"
        className="mt-6 font-[var(--cl-font-body)] text-sm text-[var(--cl-accent)] underline"
      >
        {t('app.notFound.homeLinkCta')}
      </a>
    </main>
  )
}
