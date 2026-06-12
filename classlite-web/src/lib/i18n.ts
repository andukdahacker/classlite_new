import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import en from '@/locales/en.json'
import vi from '@/locales/vi.json'
import { readLanguageCookie } from '@/lib/language-cookie'

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

export default i18n
