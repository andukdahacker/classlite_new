/**
 * ProfilePage — Story 9.4 `/profile` (s38), all-roles (AC1 / AC2).
 *
 * Mounted under AppLayout with NO RouteRoleGate — every role reaches it and the
 * page renders inside the caller's current role shell. Implements the UX-1
 * trilogy for the GET /me load: a form-shaped skeleton, a human error + one
 * retry, and the loaded shell. The shell composes the role-specific identity
 * strip (D14) with the common Account / Preferences / Notifications /
 * Change-password sections.
 */
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useProfile } from './api/useProfile'
import { AccountSection } from './components/AccountSection'
import { ChangePasswordSection } from './components/ChangePasswordSection'
import { NotificationsSection } from './components/NotificationsSection'
import { PreferencesSection } from './components/PreferencesSection'
import { ProfileIdentityStrip } from './components/ProfileIdentityStrip'

function ProfileSkeleton() {
  return (
    <div className="grid gap-6" data-testid="profile-skeleton" aria-busy="true">
      <Skeleton className="h-8 w-48" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-40 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  )
}

export default function ProfilePage() {
  const { t } = useTranslation()
  const { data, isLoading, isError, refetch } = useProfile()

  return (
    <main
      className="mx-auto grid max-w-2xl gap-6 p-6"
      aria-labelledby="profile-heading"
    >
      <h1
        id="profile-heading"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        {t('profile.heading')}
      </h1>

      {isLoading ? (
        <ProfileSkeleton />
      ) : isError || !data ? (
        <div
          role="alert"
          className="grid gap-3 rounded-lg border border-destructive/40 bg-destructive/10 p-6"
          data-testid="profile-error"
        >
          <p className="text-sm text-destructive">{t('profile.error.body')}</p>
          <div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              data-testid="profile-retry"
            >
              {t('profile.error.retry')}
            </Button>
          </div>
        </div>
      ) : (
        <div className="grid gap-6" data-testid="profile-loaded">
          <ProfileIdentityStrip />
          <AccountSection profile={data} />
          <PreferencesSection profile={data} />
          <NotificationsSection profile={data} />
          <ChangePasswordSection profile={data} />
        </div>
      )}
    </main>
  )
}
