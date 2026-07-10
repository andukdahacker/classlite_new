/**
 * usePutOnboardingProgress — Story 2-3a AC6 (debounced auto-save) + AC3/AC7
 * (explicit resume-bookmark advance).
 *
 * onSuccess writes the response directly to the `onboardingKeys.progress()`
 * cache slot via `setQueryData` — avoids a refetch on every auto-save cycle
 * (project-context FW-3 rationale: staleTime keeps the value hot regardless).
 *
 * onError is intentionally a no-op — the caller (`useAutoSave`) re-fires on the
 * next debounce cycle. The `saveSeq` guard inside `useAutoSave` prevents
 * out-of-order writes from stomping a later value.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { onboardingKeys } from './onboardingKeys'
import type { OnboardingProgressResult } from './useOnboardingProgress'

export type OnboardingProgressPayload =
  components['schemas']['OnboardingProgressPayload']
export type PutOnboardingProgressResult =
  components['schemas']['PutOnboardingProgressResult']

export interface PutOnboardingProgressInput {
  currentStep: PutOnboardingProgressResult['currentStep']
  payload: OnboardingProgressPayload
}

export function usePutOnboardingProgress() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: onboardingKeys.putProgressMutation(),
    mutationFn: (input: PutOnboardingProgressInput) =>
      apiFetch<PutOnboardingProgressResult>('/api/onboarding/progress', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<OnboardingProgressResult>(
        onboardingKeys.progress(),
        (previous: OnboardingProgressResult | undefined) => ({
          currentStep: data.currentStep,
          payload: data.payload,
          updatedAt: data.updatedAt,
          persona: previous?.persona ?? data.payload.personaChoice ?? null,
        }),
      )
    },
  })
}
