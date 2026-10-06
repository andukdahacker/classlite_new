/**
 * PreferencesSection — Story 9.4 language preference (AC3 / AC13).
 *
 * Language applies INSTANTLY via the shipped `setLanguage()` → cookie →
 * `i18n.changeLanguage` bridge (no Save button) AND is persisted to
 * `users.language_pref` via a full-snapshot PUT. The PUT carries the SAVED
 * name/avatar/notif from the loaded profile (NOT any unsaved AccountSection
 * name edit — independent surfaces, AC13), so switching language never clobbers
 * an in-progress name edit.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useLanguageStore, type Language } from '@/stores/languageStore'
import type { UserProfile } from '../api/useProfile'
import { useUpdateProfile } from '../api/useUpdateProfile'

interface PreferencesSectionProps {
  profile: UserProfile
}

const LANGUAGES: readonly Language[] = ['vi', 'en']

export function PreferencesSection({ profile }: PreferencesSectionProps) {
  const { t } = useTranslation()
  const language = useLanguageStore((s) => s.language)
  const setLanguage = useLanguageStore((s) => s.setLanguage)
  const updateProfile = useUpdateProfile()
  const [saveError, setSaveError] = useState(false)

  const handleSelect = (lang: Language) => {
    if (lang === profile.languagePref) {
      // Already persisted; just re-assert the instant UI switch, no redundant PUT.
      setSaveError(false)
      setLanguage(lang)
      return
    }
    const previousLanguage = language
    setSaveError(false)
    setLanguage(lang) // instant re-render (AC3) — the bridge owns the I/O.
    updateProfile.mutate(
      {
        fullName: profile.fullName,
        avatarUrl: profile.avatarUrl,
        languagePref: lang,
        notificationSettings: profile.notificationSettings,
      },
      {
        // UX-1 (review patch P2) — a swallowed failure left the UI on the new
        // language while the server kept the old one. Revert the instant switch
        // and surface a retryable error so UI and persisted state stay in sync.
        onError: () => {
          setLanguage(previousLanguage)
          setSaveError(true)
        },
      },
    )
  }

  return (
    <section
      aria-labelledby="profile-preferences-heading"
      className="grid gap-4 rounded-lg border border-[var(--cl-line)] p-6"
      data-testid="profile-preferences-section"
    >
      <h2
        id="profile-preferences-heading"
        className="text-lg font-medium text-[var(--cl-ink)]"
      >
        {t('profile.preferences.heading')}
      </h2>
      <div
        role="group"
        aria-label={t('profile.preferences.languageLabel')}
        className="inline-flex w-fit items-center rounded-[var(--cl-radius-full)] border border-[var(--cl-line)] bg-[var(--cl-surface)] p-1"
      >
        {LANGUAGES.map((lang) => {
          const active = language === lang
          return (
            <button
              key={lang}
              type="button"
              aria-pressed={active}
              onClick={() => handleSelect(lang)}
              data-testid={`profile-language-${lang}`}
              className={
                active
                  ? 'rounded-[var(--cl-radius-full)] bg-[var(--cl-ink)] px-3 py-1 text-sm text-[var(--cl-surface)]'
                  : 'rounded-[var(--cl-radius-full)] px-3 py-1 text-sm text-[var(--cl-ink-soft)]'
              }
            >
              {t(`profile.preferences.language.${lang}`)}
            </button>
          )
        })}
      </div>
      {saveError && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="profile-preferences-save-error"
        >
          {t('profile.preferences.saveFailed')}
        </p>
      )}
    </section>
  )
}
