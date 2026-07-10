/**
 * useOnboardingProgress — Story 2-3a AC10 GET progress.
 *
 * `retry: false` is a deliberate project-context FW-3 override: this is a
 * single-shot fetch on route entry; refresh happens via auto-save + explicit
 * mutation invalidation, not by TanStack Query's retry machinery. Auth (401)
 * still routes through `apiFetch`'s silent-refresh path — bypassing FW-3
 * doesn't skip that.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { DEFAULT_STALE_TIME_MS } from '@/lib/query-client'
import { onboardingKeys } from './onboardingKeys'

export type OnboardingProgressResult =
  components['schemas']['OnboardingProgressResult']

export interface UseOnboardingProgressOptions {
  /**
   * Defaults to `true`. Callers on pre-auth boundaries (`PersonaSelectPage`,
   * `CenterSetupPage`) pass `!!user && emailVerified` so the GET does not
   * fire during the tick between mount and the layout's auth-redirect. The
   * `TeacherDashboard` caller omits this — its layout guarantees auth.
   */
  enabled?: boolean
}

export function useOnboardingProgress(
  options: UseOnboardingProgressOptions = {},
) {
  return useQuery({
    queryKey: onboardingKeys.progress(),
    queryFn: () =>
      apiFetch<OnboardingProgressResult>('/api/onboarding/progress'),
    staleTime: DEFAULT_STALE_TIME_MS,
    // Justification (FW-3 override): single-shot on route entry, refresh via
    // auto-save. R1-P35 originally proposed `retry: 1` for 5xx, but the
    // PersonaSelectPage renders a "Try again" retry CTA on the error branch
    // (R1-P25), giving the user an explicit manual retry path — TanStack
    // Query's implicit retry is not needed AND its default backoff delay
    // conflicts with jsdom test timeouts. Stay at `retry: false`.
    retry: false,
    enabled: options.enabled ?? true,
  })
}
