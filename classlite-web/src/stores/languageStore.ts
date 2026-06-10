/**
 * languageStore — pure language state holder.
 *
 * Story 1-7b ships ONLY the state. The side effect wiring
 * (`i18n.changeLanguage`, `.classlite.app` cookie sync per UX-DR17,
 * cross-domain landing/dashboard handoff) lands with Story 1-7c. Do NOT
 * import `i18n` from the store action — that wiring belongs in
 * components or in a 1-7c-owned subscription helper.
 *
 * `initialState` MUST be exported (project-context TEST-FE-3 reset
 * pattern).
 */
import { create } from 'zustand'

export type Language = 'en' | 'vi'

export interface LanguageState {
  language: Language
}

export interface LanguageActions {
  setLanguage: (language: Language) => void
  reset: () => void
}

export const initialState: LanguageState = {
  language: 'en',
}

export const useLanguageStore = create<LanguageState & LanguageActions>(
  (set) => ({
    ...initialState,
    setLanguage: (language) => set({ language }),
    reset: () => set({ ...initialState }),
  }),
)
