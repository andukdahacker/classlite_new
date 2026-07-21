/**
 * useUpdateTemplate — Story 3.3 (AC4/AC6). PUT /api/templates/{id} (full
 * replace) → the updated TemplateDetail, with the FW-2 optimistic triple on the
 * detail cache: onMutate cancels + snapshots + optimistically merges the request
 * scalars/sessions into the cached detail; onError rolls back to the literal
 * snapshot; onSettled invalidates detail(id) + the lists (usedCount is
 * server-owned).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { onboardingKeys } from '@/features/onboarding'
import type { components } from '@/lib/api/client'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import { templateKeys } from './templateKeys'
import type { TemplateDetailWire } from './useTemplate'

export type UpdateTemplateRequest = components['schemas']['UpdateTemplateRequest']

interface UpdateContext {
  previous: TemplateDetailWire | undefined
}

/** Merge the request into the cached detail for the optimistic paint. */
function optimisticDetail(
  previous: TemplateDetailWire,
  body: UpdateTemplateRequest,
): TemplateDetailWire {
  return {
    ...previous,
    name: body.name,
    targetBand: body.targetBand,
    primarySkill: body.primarySkill,
    color: body.color ?? null,
    sessionCount: body.sessions.length,
    sessions: body.sessions.map((s, index) => ({
      id: `optimistic-${index}`,
      title: s.title,
      description: s.description ?? null,
      sessionOrder: index,
      duration: s.duration ?? null,
    })),
  }
}

export function useUpdateTemplate(id: string) {
  const queryClient = useQueryClient()

  return useMutation<
    TemplateDetailWire,
    ApiError,
    UpdateTemplateRequest,
    UpdateContext
  >({
    mutationKey: templateKeys.updateMutation(id),
    mutationFn: (body) =>
      apiFetch<TemplateDetailWire>(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: templateKeys.detail(id) })
      const previous = queryClient.getQueryData<TemplateDetailWire>(
        templateKeys.detail(id),
      )
      if (previous) {
        queryClient.setQueryData<TemplateDetailWire>(
          templateKeys.detail(id),
          optimisticDetail(previous, body),
        )
      }
      return { previous }
    },
    onError: (_err, _body, ctx) => {
      queryClient.setQueryData(templateKeys.detail(id), ctx?.previous)
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: templateKeys.detail(id) })
      queryClient.invalidateQueries({ queryKey: templateKeys.lists() })
      // CR-3-3 fix — keep the class-create dialog picker (separate onboarding
      // cache) in sync with edited template scalars.
      queryClient.invalidateQueries({ queryKey: onboardingKeys.templates() })
    },
  })
}
