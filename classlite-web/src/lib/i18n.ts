import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'
import { readLanguageCookie } from '@/lib/language-cookie'
import { formatVnDate } from '@/lib/formatVnDate'
import { formatVnDateLong } from '@/lib/formatVnDateLong'

// Story 1-7c AC6 — seed the initial language from the `lang` cookie. If
// the cookie is absent or malformed, fall back to English. Reading at
// module-load (synchronous `document.cookie` access) ensures the very
// first paint uses the right language so the UI never flickers from en
// → vi after `useLanguageInit()` runs in App.tsx.
i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    vi: { translation: vi },
  },
  lng: readLanguageCookie() ?? 'en',
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
})

// TS-6 — the i18n layer owns date formatting. Register a `vnDate` formatter so
// a `{{val, vnDate}}` token (e.g. `billing.meter.resetAt`) routes the raw ISO
// string through `formatVnDate`. Components pass the raw wire string to `t(...)`
// and never call `new Date().toLocaleDateString()` in a render path.
i18n.services.formatter?.add('vnDate', (value, lng) =>
  typeof value === 'string' ? formatVnDate(value, lng ?? 'en') : String(value),
)

// Story 9.3 (M7) — the long `{{val, vnDateLong}}` token (e.g. `billing.grace.deadline`)
// renders the grace day-7 deadline as a spelled-out `12 Oct 2026`, derived from graceEndsAt.
i18n.services.formatter?.add('vnDateLong', (value, lng) =>
  typeof value === 'string' ? formatVnDateLong(value, lng ?? 'en') : String(value),
)

export default i18n
