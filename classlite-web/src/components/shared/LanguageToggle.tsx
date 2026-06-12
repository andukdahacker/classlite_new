/**
 * LanguageToggle — bilingual switch (UX-DR17).
 *
 * Reads `language` from `useLanguageStore`. On click, calls
 * `setLanguage(lng)`. The side-effect bridge in `useLanguageInit()`
 * (mounted once in App.tsx) subscribes to the store and turns the
 * mutation into the cookie write + `i18n.changeLanguage(lng)` call.
 *
 * The action stays pure (FW-5 + FW-6) — store mutations never trigger
 * side effects directly; the subscriber owns the I/O.
 *
 * Visually: pill-shaped fieldset with two segments. The active segment
 * carries `aria-pressed="true"` AND a contrasting background; the
 * inactive segment is muted. Both segments stay reachable by keyboard.
 */
import { useTranslation } from 'react-i18next'
import { useLanguageStore } from '@/stores/languageStore'

export default function LanguageToggle() {
  const { t } = useTranslation()
  const language = useLanguageStore((s) => s.language)
  const setLanguage = useLanguageStore((s) => s.setLanguage)

  return (
    <div
      role="group"
      aria-label={t('app.layout.languageToggle.aria')}
      className="inline-flex items-center rounded-[var(--cl-radius-full)] border border-[var(--cl-line)] bg-[var(--cl-surface)] p-1"
    >
      <button
        type="button"
        aria-pressed={language === 'en'}
        onClick={() => setLanguage('en')}
        className={
          language === 'en'
            ? 'rounded-[var(--cl-radius-full)] bg-[var(--cl-ink)] px-3 py-1 text-sm text-[var(--cl-surface)]'
            : 'rounded-[var(--cl-radius-full)] px-3 py-1 text-sm text-[var(--cl-ink-soft)]'
        }
      >
        {t('app.layout.languageToggle.en')}
      </button>
      <button
        type="button"
        aria-pressed={language === 'vi'}
        onClick={() => setLanguage('vi')}
        className={
          language === 'vi'
            ? 'rounded-[var(--cl-radius-full)] bg-[var(--cl-ink)] px-3 py-1 text-sm text-[var(--cl-surface)]'
            : 'rounded-[var(--cl-radius-full)] px-3 py-1 text-sm text-[var(--cl-ink-soft)]'
        }
      >
        {t('app.layout.languageToggle.vi')}
      </button>
    </div>
  )
}
