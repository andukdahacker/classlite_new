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
  // Story 2-3b Task 1.2 — GET /api/templates cache key. Extension only; do
  // NOT scope by centerId. `useListTemplates` explicitly evicts on auth
  // transition (Murat-S8) so a stale-window cross-tenant leak is impossible.
  templates: () => [...onboardingKeys.all, 'templates'] as const,
  personaMutation: () =>
    [...onboardingKeys.all, 'mutation', 'persona'] as const,
  putProgressMutation: () =>
    [...onboardingKeys.all, 'mutation', 'put-progress'] as const,
  createCenterMutation: () =>
    [...onboardingKeys.all, 'mutation', 'create-center'] as const,
  // Story 2-3b Task 1.2 — POST spawn mutation key. Winston-W3 fold: onSuccess
  // does NOT invalidate the templates cache — user has left /setup/template
  // by the time spawn resolves; invalidate is spec noise.
  spawnMutation: () => [...onboardingKeys.all, 'mutation', 'spawn'] as const,
}
