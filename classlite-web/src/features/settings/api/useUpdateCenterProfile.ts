/**
 * useUpdateCenterProfile — Story 2-5a AC3 PATCH /api/centers/{id}.
 *
 * Cache-write contract (Winston-S10 + Amelia-INFO fold + John ACCEPT):
 *   - On success, IMPERATIVELY WRITE the updated fields into
 *     `authKeys.session()` via `queryClient.setQueryData` (NOT
 *     invalidateQueries). Sidebar + topbar re-read via cache subscription
 *     without a refetch flicker. Matches shipped `useCreateCenter.ts:72-80`.
 *
 * Optimistic triple (FW-2 mandatory):
 *   - onMutate cancels queries + snapshots previous profile + optimistically
 *     applies the change to the settings profile cache.
 *   - onError rolls back to the snapshot.
 *   - onSettled invalidates the settings profile key so the source of truth
 *     wins on the eventual refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import {
  authKeys,
  type CenterSummary,
  type Session,
} from '@/features/auth/api/authKeys'
import { settingsKeys } from './settingsKeys'
import type { CenterProfile } from './useCenterProfile'

export type UpdateCenterProfileRequest =
  components['schemas']['UpdateCenterProfileRequest']

interface OptimisticContext {
  previousProfile: CenterProfile | undefined
}

export function useUpdateCenterProfile(centerId: string) {
  const queryClient = useQueryClient()
  const profileKey = settingsKeys.centerProfile(centerId)

  return useMutation<
    CenterProfile,
    Error,
    UpdateCenterProfileRequest,
    OptimisticContext
  >({
    mutationKey: settingsKeys.updateCenterProfileMutation(centerId),
    mutationFn: (input: UpdateCenterProfileRequest) =>
      apiFetch<CenterProfile>(`/api/centers/${centerId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: profileKey })
      const previousProfile = queryClient.getQueryData<CenterProfile>(profileKey)
      if (previousProfile) {
        queryClient.setQueryData<CenterProfile>(profileKey, {
          ...previousProfile,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.contactEmail !== undefined
            ? { contactEmail: input.contactEmail }
            : {}),
          ...(input.brandColor !== undefined
            ? { brandColor: input.brandColor }
            : {}),
          ...(input.timezone !== undefined
            ? { timezone: input.timezone }
            : {}),
        })
      }
      return { previousProfile }
    },
    onError: (_err, _input, context) => {
      if (context?.previousProfile) {
        queryClient.setQueryData<CenterProfile>(
          profileKey,
          context.previousProfile,
        )
      }
    },
    onSuccess: (data) => {
      // Winston-S10 + AC3: imperative cache write into authKeys.session()
      // so the sidebar + topbar re-render with the fresh center name / brand
      // color WITHOUT a refetch flicker.
      const previousSession = queryClient.getQueryData<Session>(
        authKeys.session(),
      )
      if (previousSession?.center) {
        const nextCenter: CenterSummary = {
          ...previousSession.center,
          name: data.name,
          brandColor: data.brandColor,
          logoUrl: data.logoUrl,
          timezone: data.timezone,
        }
        queryClient.setQueryData<Session>(authKeys.session(), {
          ...previousSession,
          center: nextCenter,
        })
      } else {
        // P7 (2026-07-15 review): session cache can be undefined during a
        // silent-refresh window or after dev-tools "clear cache". Without
        // this fallback, the sidebar / topbar keep the old center name
        // until the next focus-refetch cycle. Refetching guarantees
        // reconciliation without racing an imperative write against an
        // in-flight boot probe.
        void queryClient.refetchQueries({ queryKey: authKeys.session() })
      }
      // Also refresh the settings profile cache so the "About" side card
      // (which reads `createdAt` etc.) has an authoritative wire copy.
      queryClient.setQueryData<CenterProfile>(profileKey, data)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKey })
    },
  })
}
