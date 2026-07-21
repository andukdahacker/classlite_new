/**
 * useCreateTemplate — Story 3.3 (AC6/AC9/AC10). POST /api/templates → the
 * created template (CreateTemplateResult). Invalidates the list on success so
 * s19 reflects the new row + its usedCount (0). Not optimistic — creation needs
 * the server-assigned id/session ids before it can render anywhere.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { onboardingKeys } from '@/features/onboarding'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { templateKeys } from './templateKeys'

export type CreateTemplateRequest = components['schemas']['CreateTemplateRequest']
export type CreateTemplateResult = components['schemas']['CreateTemplateResult']

export function useCreateTemplate() {
  const queryClient = useQueryClient()

  return useMutation<CreateTemplateResult, ApiError, CreateTemplateRequest>({
    mutationKey: templateKeys.createMutation(),
    mutationFn: (body) =>
      apiFetch<CreateTemplateResult>('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
      // CR-3-3 fix — the class-create dialog picker reads the deliberately
      // separate onboarding templates cache; refresh it so a newly created
      // template is offered without waiting out its staleTime.
      queryClient.invalidateQueries({ queryKey: onboardingKeys.templates() })
    },
  })
}
