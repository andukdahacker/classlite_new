/**
 * LoginPagePlaceholder — placeholder route stub for /login.
 *
 * Exists so the auth lazy bundle group has a real child to render and
 * Rolldown actually emits the auth chunk. The functional login form
 * ships with Story 1-8.
 *
 * Story 1-7c rewires the H1 to `auth.login.title` (was `app.welcome`)
 * so the bilingual smoke spec's `/login` assertion is satisfied in
 * both en and vi before Story 1-8 lands the real LoginPage.
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
        {t('auth.login.title')}
      </h1>
    </div>
  )
}
