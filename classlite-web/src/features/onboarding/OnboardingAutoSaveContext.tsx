/**
 * OnboardingAutoSaveContext — Story 2-3a Task 5.2.
 *
 * Provider owned by `OnboardingLayout`, consumed by `CenterSetupPage` (which
 * fires `scheduleSave` on tracked field changes) AND the shell's
 * `AutoSaveIndicator` component (which renders the `savingState` +
 * `lastSavedAt` affordance).
 *
 * PersonaSelectPage does NOT consume this context — persona pick is a
 * one-shot POST at AC3, not a debounced draft.
 */
/* eslint-disable react-refresh/only-export-components -- context + hook + provider intentionally co-located; splitting adds no HMR value for the wizard */
import { createContext, useContext, type ReactNode } from 'react'
import {
  useAutoSave,
  type OnboardingStep,
  type UseAutoSaveResult,
} from './hooks/useAutoSave'

const OnboardingAutoSaveContext = createContext<UseAutoSaveResult | null>(null)

export interface OnboardingAutoSaveProviderProps {
  children: ReactNode
  /**
   * Story 2-3b Winston-W1 fold — the wizard step this Provider's auto-save
   * PUTs bookmark. `OnboardingLayout` derives this from `useLocation().pathname`
   * so every child page (`/setup/center`, `/setup/template`, `/setup/spawn`,
   * `/setup/first-class`) writes the correct `currentStep`. Without this
   * prop, every downstream page would ship `currentStep: 'center'` (the
   * Story 2-3a default) and trash resume-routing.
   */
  currentStep?: OnboardingStep
}

export function OnboardingAutoSaveProvider({
  children,
  currentStep,
}: OnboardingAutoSaveProviderProps) {
  const autoSave = useAutoSave({ currentStep })
  return (
    <OnboardingAutoSaveContext.Provider value={autoSave}>
      {children}
    </OnboardingAutoSaveContext.Provider>
  )
}

export function useOnboardingAutoSave(): UseAutoSaveResult {
  const ctx = useContext(OnboardingAutoSaveContext)
  if (ctx === null) {
    throw new Error(
      'useOnboardingAutoSave must be used inside an OnboardingAutoSaveProvider',
    )
  }
  return ctx
}
