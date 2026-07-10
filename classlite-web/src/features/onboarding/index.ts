/**
 * Onboarding feature barrel — Story 2-3a (Murat-I1 contract lock-down).
 *
 * Public surface consumed by routes + downstream stories (2.3b / 2.3c). Do
 * NOT extend the shape without a story amendment; the barrel is what the
 * route table + TeacherDashboard welcome-back banner import from.
 */
export { default as OnboardingLayout } from './OnboardingLayout'
export { default as PersonaSelectPage } from './PersonaSelectPage'
export { default as CenterSetupPage } from './CenterSetupPage'
export {
  OnboardingAutoSaveProvider,
  useOnboardingAutoSave,
} from './OnboardingAutoSaveContext'
export { useAutoSave } from './hooks/useAutoSave'
export type {
  SavingState,
  UseAutoSaveResult,
  UseAutoSaveOptions,
} from './hooks/useAutoSave'
export { onboardingKeys } from './api/onboardingKeys'
export { useOnboardingProgress } from './api/useOnboardingProgress'
export type { OnboardingProgressResult } from './api/useOnboardingProgress'
export {
  RadioGroupTile,
  RadioGroupTiles,
} from './components/RadioGroupTile'
