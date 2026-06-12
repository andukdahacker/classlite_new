/**
 * UserPill — sidebar foot identity slot.
 *
 * Story 1-7c ships the no-session placeholder. The real avatar + name +
 * role label render lands when Story 1-8 fills `useAuth()` with a real
 * session. The role-variant nav set (Owner / Admin / Teacher / Student)
 * lives in Epic 1D Story 1d-3 — this component supplies only the foot of
 * the sidebar today.
 */
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'

const ROLE_KEYS = {
  owner: 'app.layout.userPill.roleLabel.owner',
  admin: 'app.layout.userPill.roleLabel.admin',
  teacher: 'app.layout.userPill.roleLabel.teacher',
  student: 'app.layout.userPill.roleLabel.student',
} as const

export default function UserPill() {
  const { t } = useTranslation()
  const { user, isAuthenticated } = useAuth()
  const role = useRole()

  if (!isAuthenticated || !user) {
    return (
      <a
        href="/login"
        className="flex w-full items-center justify-center rounded-[var(--cl-radius-full)] bg-[var(--cl-sidebar-hover)] px-4 py-2 text-sm text-[var(--cl-sidebar-text)] hover:text-[var(--cl-sidebar-active-bg)]"
      >
        {t('auth.login.submit')}
      </a>
    )
  }

  const initials = user.displayName
    .split(' ')
    .map((part) => part[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="flex w-full items-center gap-3 px-2 py-1.5 text-sm text-[var(--cl-sidebar-text)]">
      <div
        aria-hidden="true"
        className="flex h-7 w-7 items-center justify-center rounded-[var(--cl-radius-full)] bg-[var(--cl-accent)] text-xs font-medium text-[var(--cl-sidebar-active-bg)]"
      >
        {initials}
      </div>
      <div className="flex min-w-0 flex-col leading-tight">
        <span className="truncate font-medium">{user.displayName}</span>
        {role && (
          <span className="truncate text-xs text-[var(--cl-sidebar-text)] opacity-70">
            {t(ROLE_KEYS[role])}
          </span>
        )}
      </div>
    </div>
  )
}
