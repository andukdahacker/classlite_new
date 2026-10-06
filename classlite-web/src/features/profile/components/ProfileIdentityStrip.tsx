/**
 * ProfileIdentityStrip — Story 9.4 (D14 / AC14) role-specific identity context.
 *
 * The account/preferences/password sections are common to all roles; only this
 * strip differs. STUDENT → a target-band pill + the enrolment footnote
 * ("enrolment is managed by your center — contact your Admin"). STAFF / OWNER →
 * a role/center line (the student-only elements are ABSENT, asserted in AC11).
 *
 * NOTE: the student's live target-band value is not part of the 9.4 self-profile
 * contract (band lives on the student-performance surface, Epic 8); the pill is
 * the structural affordance + the enrolment guidance that 9.4 owns.
 */
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'

export function ProfileIdentityStrip() {
  const { t } = useTranslation()
  const role = useRole()
  const { session } = useAuth()
  const centerName = session?.center?.name ?? null

  if (role === 'student') {
    return (
      <div
        className="grid gap-2 rounded-lg bg-[var(--cl-surface-soft)] p-4"
        data-testid="profile-identity-student"
      >
        <Badge variant="secondary" data-testid="profile-band-pill">
          {t('profile.identity.targetBand')}
        </Badge>
        <p
          className="text-xs text-[var(--cl-ink-soft)]"
          data-testid="profile-enrolment-footnote"
        >
          {t('profile.identity.enrolmentFootnote')}
        </p>
      </div>
    )
  }

  return (
    <p
      className="text-sm text-[var(--cl-ink-soft)]"
      data-testid="profile-role-line"
    >
      {role
        ? t(`profile.identity.roleLine.${role}`, {
            center: centerName ?? t('profile.identity.noCenter'),
          })
        : t('profile.identity.noCenter')}
    </p>
  )
}
