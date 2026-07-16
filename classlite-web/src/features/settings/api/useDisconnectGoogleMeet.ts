/**
 * useDisconnectGoogleMeet — Story 2-5c AC3 Disconnect flow.
 *
 * DELETE /api/centers/{id}/integrations/google-meet → invalidate
 * settingsKeys.centerProfile(centerId) so `googleMeetConnected` re-reads.
 * Optimistic triple pattern (cancel + snapshot + rollback on error +
 * invalidate on settled) mirrors 2-5b's useMutateRoom.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'

type CenterProfile = components['schemas']['CenterProfile']

interface OptimisticContext {
  previous: CenterProfile | undefined
}

export function useDisconnectGoogleMeet(centerId: string) {
  const queryClient = useQueryClient()
  const profileKey = settingsKeys.centerProfile(centerId)

  return useMutation<void, Error, void, OptimisticContext>({
    mutationKey: [...settingsKeys.integration(centerId, 'google_meet'), 'disconnect'],
    mutationFn: () =>
      apiFetch<void>(`/api/centers/${centerId}/integrations/google-meet`, {
        method: 'DELETE',
      }).then(() => undefined),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: profileKey })
      const previous = queryClient.getQueryData<CenterProfile>(profileKey)
      // Optimistic flip — the connected pill switches to "Not connected"
      // immediately; onError restores the snapshot if the request fails.
      if (previous) {
        queryClient.setQueryData<CenterProfile>(profileKey, {
          ...previous,
          googleMeetConnected: false,
        })
      }
      return { previous }
    },
    onError: (_err, _input, ctx) => {
      if (ctx?.previous) {
        queryClient.setQueryData(profileKey, ctx.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: profileKey })
    },
  })
}
