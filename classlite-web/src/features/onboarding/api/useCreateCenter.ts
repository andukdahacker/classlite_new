/**
 * useCreateCenter — Story 2-3a AC7 + AC9, Task 3.5.
 *
 * onSuccess responsibilities (Murat-S8 party-mode contract):
 *   1. Bump `Session.accessToken` to the fresh JWT (has center+role claims).
 *   2. Write `Session.center` slot with the six-field `CenterSummary`.
 *   3. Invalidate `onboardingKeys.progress()` so next GET reflects the new
 *      wizard step.
 *
 * If no existing session cache entry is present (defensive — should not
 * happen because AC8's route guards ensure `useAuth()` has hydrated before
 * the wizard renders), the writer bails on the cache write instead of
 * synthesizing a partial `Session`.
 *
 * onError propagates the raw `ApiError` — the page (`CenterSetupPage`) reads
 * `error.status` + `error.code` to branch through the 5-error matrix in AC7.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Sentry from '@sentry/react'
import type { components } from '@/lib/api/client'
import { apiFetch, AuthExpiredError } from '@/lib/api-fetch'
import { onAuthFailure } from '@/lib/auth-refresh'
import {
  authKeys,
  type CenterSummary,
  type Session,
} from '@/features/auth/api/authKeys'
import { onboardingKeys } from './onboardingKeys'

export type CreateCenterRequest = {
  name: string
  brandColor: string | null
  logoUrl: string | null
}

export type CreateCenterResult = components['schemas']['CreateCenterResult']

export function useCreateCenter() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: onboardingKeys.createCenterMutation(),
    mutationFn: (input: CreateCenterRequest) =>
      apiFetch<CreateCenterResult>('/api/centers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onSuccess: async (data) => {
      const previous = queryClient.getQueryData<Session>(authKeys.session())
      const center: CenterSummary = {
        id: data.id,
        name: data.name,
        shortCode: data.shortCode,
        brandColor: data.brandColor,
        logoUrl: data.logoUrl,
        timezone: data.timezone,
      }
      if (!previous) {
        // Session cache went undefined between mutation start and this
        // success (rare boot-probe race). Session.user is a required
        // UserSummary and cannot be synthesized from the create-center
        // response, so we CANNOT write a valid Session. Surface via the
        // auth-failure redirect path rather than silently succeeding
        // while the client stays in a broken auth state.
        Sentry.captureMessage(
          'useCreateCenter.onSuccess: session cache was empty at write',
          { level: 'warning', tags: { centerId: data.id } },
        )
        onAuthFailure(new AuthExpiredError())
        return
      }
      queryClient.setQueryData<Session>(authKeys.session(), {
        ...previous,
        // Always take `data.accessToken` — the create-center response's
        // JWT carries the fresh `center_id` + `role` claims that a
        // silent-refresh-rotated token would NOT have (refresh preserves
        // prior state; it doesn't re-derive claims).
        accessToken: data.accessToken,
        center,
      })
      // Awaited so downstream navigations (e.g. Story 2.3b's mount reading
      // fresh progress) see the invalidated cache. Fire-and-forget here
      // caused a stale-read on the next page mount when the navigate ran
      // faster than the invalidation.
      await queryClient.invalidateQueries({
        queryKey: onboardingKeys.progress(),
      })
    },
  })
}
