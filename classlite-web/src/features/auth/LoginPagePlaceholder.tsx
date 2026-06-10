/**
 * LoginPagePlaceholder — placeholder route stub for /login.
 *
 * Exists so the auth lazy bundle group has a real child to render and
 * Rolldown actually emits the auth chunk. The functional login form
 * ships with Story 1-8.
 */
import { useTranslation } from 'react-i18next'

export default function LoginPagePlaceholder() {
  const { t } = useTranslation()
  return (
    <div className="flex min-h-screen items-center justify-center">
      <h1
        data-testid="login-placeholder-heading"
        className="font-[var(--cl-font-display)] text-3xl text-[var(--cl-ink)]"
      >
        {t('app.welcome')}
      </h1>
    </div>
  )
}
