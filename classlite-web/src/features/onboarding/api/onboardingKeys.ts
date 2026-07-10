/**
 * onboardingKeys — TanStack Query key factory for the onboarding feature
 * (project-context TS-3 + FW-6).
 *
 * Mutation keys are DISTINCT from cache keys (Story 1-8 P5 amendment). The
 * `progress()` cache key is shared across the GET + all cache-write callers so
 * `setQueryData(onboardingKeys.progress(), ...)` from an auto-save PUT and the
 * subsequent `useOnboardingProgress()` GET stay coherent.
 */

export const onboardingKeys = {
  all: ['onboarding'] as const,
  progress: () => [...onboardingKeys.all, 'progress'] as const,
  personaMutation: () =>
    [...onboardingKeys.all, 'mutation', 'persona'] as const,
  putProgressMutation: () =>
    [...onboardingKeys.all, 'mutation', 'put-progress'] as const,
  createCenterMutation: () =>
    [...onboardingKeys.all, 'mutation', 'create-center'] as const,
}
