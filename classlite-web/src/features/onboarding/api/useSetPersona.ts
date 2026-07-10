/**
 * useSetPersona — Story 2-3a AC3 POST persona.
 *
 * Idempotent per Story 2.1 AC1 — a re-click on the same value is safe. onSuccess
 * invalidates `onboardingKeys.progress()` so the next GET reflects the new
 * persona (the wizard often reads progress right after selection).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { onboardingKeys } from './onboardingKeys'
import type { PersonaValue } from '../lib/personaSchema'

export type SetPersonaResult = components['schemas']['SetPersonaResult']

export function useSetPersona() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: onboardingKeys.personaMutation(),
    mutationFn: (persona: PersonaValue) =>
      apiFetch<SetPersonaResult>('/api/onboarding/persona', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ persona }),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: onboardingKeys.progress(),
      })
    },
  })
}
