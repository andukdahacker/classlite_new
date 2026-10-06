/**
 * NotificationsSection — Story 9.4 (AC12 / D15).
 *
 * The toggles render DISABLED with a bilingual "arrives with your inbox (coming
 * soon); your choices save for then" note — NO inert-but-enabled switch (D15:
 * that reads as a dark pattern). The persisted values ride the profile contract;
 * Epic 10 wires the live consumer and is authoritative over them. The switches
 * reflect the stored `notificationSettings` so the state is honest, just frozen.
 */
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import type { UserProfile } from '../api/useProfile'

interface NotificationsSectionProps {
  profile: UserProfile
}

const TOGGLES = [
  { key: 'emailOnSubmission', labelKey: 'profile.notifications.onSubmission' },
  { key: 'emailOnQuestion', labelKey: 'profile.notifications.onQuestion' },
  { key: 'emailOnAnnouncement', labelKey: 'profile.notifications.onAnnouncement' },
] as const

export function NotificationsSection({ profile }: NotificationsSectionProps) {
  const { t } = useTranslation()
  const settings = profile.notificationSettings

  return (
    <section
      aria-labelledby="profile-notifications-heading"
      className="grid gap-4 rounded-lg border border-[var(--cl-line)] p-6"
      data-testid="profile-notifications-section"
    >
      <h2
        id="profile-notifications-heading"
        className="text-lg font-medium text-[var(--cl-ink)]"
      >
        {t('profile.notifications.heading')}
      </h2>
      <p
        className="text-sm text-[var(--cl-ink-soft)]"
        data-testid="profile-notifications-note"
      >
        {t('profile.notifications.comingSoonNote')}
      </p>
      <ul className="grid gap-3">
        {TOGGLES.map((toggle) => (
          <li key={toggle.key} className="flex items-center justify-between gap-4">
            <span className="text-sm text-[var(--cl-ink)]">
              {t(toggle.labelKey)}
            </span>
            <Switch
              checked={settings[toggle.key]}
              disabled
              aria-label={t(toggle.labelKey)}
              data-testid={`profile-notif-${toggle.key}`}
            />
          </li>
        ))}
      </ul>
    </section>
  )
}
