/**
 * Onboarding feature barrel — Story 2-3a (Murat-I1 contract lock-down) +
 * Story 2-3b amendment (3 new pages + 2 API hooks + useCountdown).
 *
 * Public surface consumed by routes + downstream stories (2.3c). Do NOT
 * extend the shape without a story amendment; the barrel is what the route
 * table + TeacherDashboard welcome-back banner import from. `AssignChip`
 * lives under `src/components/domain/` (Epic 1D component-inventory line 72)
 * and is imported through its own module path, NOT this barrel — cross-
 * feature reuse expected.
 */
export { default as OnboardingLayout } from './OnboardingLayout'
export { default as PersonaSelectPage } from './PersonaSelectPage'
export { default as CenterSetupPage } from './CenterSetupPage'
export { default as TemplateSelectPage } from './TemplateSelectPage'
export { default as ClassSpawnPage } from './ClassSpawnPage'
export { default as SoloFirstClassPage } from './SoloFirstClassPage'
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
export { useCountdown } from './hooks/useCountdown'
export type {
  UseCountdownOptions,
  UseCountdownResult,
} from './hooks/useCountdown'
export { onboardingKeys } from './api/onboardingKeys'
export { useOnboardingProgress } from './api/useOnboardingProgress'
export type { OnboardingProgressResult } from './api/useOnboardingProgress'
export { useListTemplates } from './api/useListTemplates'
export type { Template, ListTemplatesResult } from './api/useListTemplates'
export { useSpawnClasses } from './api/useSpawnClasses'
export type {
  SpawnClassInput,
  SpawnResult,
  SpawnedClass,
  SpawnClassesVariables,
} from './api/useSpawnClasses'
export {
  RadioGroupTile,
  RadioGroupTiles,
} from './components/RadioGroupTile'
