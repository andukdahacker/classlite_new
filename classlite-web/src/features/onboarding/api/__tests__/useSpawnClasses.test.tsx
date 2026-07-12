/**
 * Story 2-3b Task 3.2 — `useSpawnClasses` mutation hook tests.
 *
 * Winston-W3 fold: onSuccess MUST NOT invalidate `onboardingKeys.templates()`.
 * User has left `/setup/template`; the templates query is inactive at
 * `/setup/done`. Invalidate is spec noise.
 *
 * Contract:
 *   mutateAsync({ templateId, classes }) → SpawnResult (envelope-unwrapped)
 *   POST /api/templates/{templateId}/spawn with body { classes }
 */
import { QueryClientProvider, useIsMutating } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, test, vi } from 'vitest'

import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import { useSpawnClasses } from '@/features/onboarding/api/useSpawnClasses'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { SYSTEM_TEMPLATE_IDS, mockSpawnInput } from './fixtures'
import { onboardingHandlers } from './handlers'

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
})

function wrapperWithClient() {
  const client = createTestQueryClient()
  return {
    client,
    wrapper: ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

describe('useSpawnClasses — envelope unwrap + contract', () => {
  test('mutateAsync returns SpawnResult (unwrapped)', async () => {
    const { wrapper } = wrapperWithClient()
    const { result } = renderHook(() => useSpawnClasses(), { wrapper })

    const spawnResult = await result.current.mutateAsync({
      templateId: SYSTEM_TEMPLATE_IDS.writingBootcamp,
      classes: [mockSpawnInput({ cohortName: 'IELTS Morning' })],
    })

    // Assert shape is the unwrapped SpawnResult, not { data, meta }
    expect(spawnResult).toMatchObject({
      classes: expect.any(Array),
      invites: expect.any(Array),
      invitesSent: expect.any(Number),
    })
    expect(spawnResult.classes[0]).toMatchObject({
      id: expect.any(String),
      name: 'IELTS Morning',
      teacherAssignmentReason: expect.stringMatching(
        /^(explicit_self|explicit_member|founder_auto|invited|unassigned)$/,
      ),
    })
  })

  test('mutationKey uses onboardingKeys.spawnMutation() factory', async () => {
    const { wrapper, client } = wrapperWithClient()
    const { result } = renderHook(() => useSpawnClasses(), { wrapper })

    // R1-C3-P1 — pin the mutationKey identity via the MutationCache. Prior
    // test asserted `toBeGreaterThanOrEqual(0)` (trivially true). Now we
    // verify the hook registered a mutation whose key exactly matches the
    // factory. `useIsMutating` transitions are timing-fragile against MSW's
    // fast happy-path resolution, so we inspect the MutationCache directly:
    // mutations linger in the cache after resolving (default gcTime) so a
    // post-await lookup is reliable.
    expect(
      client.getMutationCache().findAll({
        mutationKey: onboardingKeys.spawnMutation(),
      }),
    ).toHaveLength(0)

    await result.current.mutateAsync({
      templateId: SYSTEM_TEMPLATE_IDS.writingBootcamp,
      classes: [mockSpawnInput()],
    })

    const matching = client.getMutationCache().findAll({
      mutationKey: onboardingKeys.spawnMutation(),
    })
    expect(matching).toHaveLength(1)
    // Belt: the recorded key MUST be exactly the factory output — a drift
    // to a different key would cause an empty match above OR a shape
    // mismatch here.
    expect(matching[0].options.mutationKey).toEqual(
      onboardingKeys.spawnMutation(),
    )
    // No-op: `useIsMutating` was previously imported but unused post-refactor.
    void useIsMutating
    // Keep waitFor imported guard from lint pruning if unused elsewhere.
    void waitFor
  })
})

describe('useSpawnClasses — Winston-W3: NO templates invalidate on success', () => {
  test('onSuccess does NOT call invalidateQueries on onboardingKeys.templates()', async () => {
    const { wrapper, client } = wrapperWithClient()
    const invalidateSpy = vi.spyOn(client, 'invalidateQueries')

    const { result } = renderHook(() => useSpawnClasses(), { wrapper })
    await result.current.mutateAsync({
      templateId: SYSTEM_TEMPLATE_IDS.writingBootcamp,
      classes: [mockSpawnInput()],
    })

    // Winston-W3 — no invalidate call for templates key
    const templatesInvalidateCalls = invalidateSpy.mock.calls.filter(
      (call) => {
        const key = call[0]?.queryKey
        if (!Array.isArray(key)) return false
        const templatesKey = onboardingKeys.templates()
        return (
          key.length === templatesKey.length &&
          key.every((v, i) => v === templatesKey[i])
        )
      },
    )
    expect(templatesInvalidateCalls).toHaveLength(0)
  })
})
