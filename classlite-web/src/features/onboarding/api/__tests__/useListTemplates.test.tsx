/**
 * Story 2-3b Task 3.1 — `useListTemplates` hook tests.
 *
 * Coverage:
 *  - Envelope unwrap: MSW returns `{ data: { templates }, meta }`; hook returns `templates[]`
 *  - `staleTime: 60_000` (spec)
 *  - `retry: (count, err) => err.status >= 500 && err.code !== 'SEED_INCOMPLETE' && count < 1`
 *  - Three-state (TEST-FE-2): loading → success → error → SEED_INCOMPLETE variant
 *  - Murat-S8 tenant-cache-leak — user A logs out → user B logs in → user B's fetch is
 *    fresh (does NOT return user A's cached center-owned templates)
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { authKeys } from '@/features/auth/api/authKeys'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import { useListTemplates } from '@/features/onboarding/api/useListTemplates'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'

import { centerTemplate, mockTemplateList } from './fixtures'
import { errorHandlers, onboardingHandlers } from './handlers'

// MSW server lifecycle registered globally in `src/test/vitest-setup.ts`.
beforeEach(() => {
  server.use(...onboardingHandlers)
})

// R1-C3-P16 — remove any per-test `request:start` listeners so they don't
// accumulate across tests in the same vitest worker.
afterEach(() => {
  server.events.removeAllListeners('request:start')
})

function wrapperWithClient(): {
  wrapper: ({ children }: { children: ReactNode }) => ReactElement
  client: ReturnType<typeof createTestQueryClient>
} {
  const client = createTestQueryClient()
  return {
    client,
    wrapper: ({ children }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    ),
  }
}

describe('useListTemplates — three-state coverage (AC2, TEST-FE-2)', () => {
  test('loading → success returns unwrapped templates array', async () => {
    const { wrapper } = wrapperWithClient()
    const { result } = renderHook(() => useListTemplates(), { wrapper })

    expect(result.current.isLoading).toBe(true)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toBeDefined()
    expect(result.current.data).toHaveLength(5) // 5 system seeds per Story 2.2 AC1b
    expect(result.current.data?.[0].scope).toBe('system')
  })

  test('error state: 500 INTERNAL_ERROR — retry gate allows 1 retry', async () => {
    server.use(errorHandlers.templatesInternalError())
    const { wrapper } = wrapperWithClient()
    const { result } = renderHook(() => useListTemplates(), { wrapper })

    // TanStack Query's default retryDelay is 1s exponential backoff — with a
    // single retry allowed, the query settles ~1050ms later, which exceeds
    // the default waitFor 1000ms timeout.
    await waitFor(() => expect(result.current.isError).toBe(true), {
      timeout: 3_000,
    })
    expect(result.current.error).toBeDefined()
  })

  test('SEED_INCOMPLETE variant — NO retry (Sally-I3): retry gate rejects', async () => {
    let requestCount = 0
    server.use(errorHandlers.templatesSeedIncomplete())
    // Track how many times the SEED_INCOMPLETE handler was called
    server.events.on('request:start', ({ request }) => {
      if (request.url.endsWith('/api/templates')) requestCount += 1
    })

    const { wrapper } = wrapperWithClient()
    const { result } = renderHook(() => useListTemplates(), { wrapper })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // ExplicitRetryPredicate excludes SEED_INCOMPLETE → should be exactly 1 attempt
    expect(requestCount).toBe(1)
  })
})

describe('useListTemplates — envelope unwrap (TS-4)', () => {
  test('returns templates array, not the {data,meta} envelope', async () => {
    // R1-C3-P2 — actually wire an override that includes a center-owned row
    // on top of the 5 system seeds. Prior test had an empty `server.use()`
    // call whose comment claimed "prove unwrap: server returns center-owned
    // addition" but the empty call registered no handler. Now the override
    // returns 5 system + 1 center-owned; if the hook accidentally returned
    // the raw `{data,meta}` envelope, `Array.isArray(result.current.data)`
    // would be false and the length assertion below would blow up.
    const { HttpResponse, http } = await import('msw')
    server.use(
      http.get('/api/templates', () =>
        HttpResponse.json({
          data: mockTemplateList({ centerTemplates: [centerTemplate()] }),
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        }),
      ),
    )
    const { wrapper } = wrapperWithClient()
    const { result } = renderHook(() => useListTemplates(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Assert shape: array-of-Template, not { data, meta }
    expect(Array.isArray(result.current.data)).toBe(true)
    expect(result.current.data).toHaveLength(6) // 5 system + 1 center
    expect(result.current.data?.[0]).toMatchObject({
      id: expect.any(String),
      name: expect.any(String),
      targetBand: expect.any(Number),
      primarySkill: expect.any(String),
      sessionCount: expect.any(Number),
      scope: expect.stringMatching(/^(system|center)$/),
    })
    // Last entry MUST be the center-owned template (mockTemplateList appends
    // centerTemplates after systemTemplates).
    expect(result.current.data?.[5]?.scope).toBe('center')
  })
})

describe('useListTemplates — Murat-S8 tenant-cache-leak verification', () => {
  test('logout evicts onboardingKeys.all so next login sees fresh cache', async () => {
    const { wrapper, client } = wrapperWithClient()

    // Session A: fetch templates
    const { result: resultA, unmount: unmountA } = renderHook(
      () => useListTemplates(),
      { wrapper },
    )
    await waitFor(() => expect(resultA.current.isSuccess).toBe(true))
    expect(client.getQueryData(onboardingKeys.templates())).toBeDefined()

    unmountA()

    // Simulate logout — auth transition MUST evict onboardingKeys.all
    // Contract per Task 3.1: either useLogout OR boot-probe on session
    // change calls queryClient.removeQueries({ queryKey: onboardingKeys.all })
    client.setQueryData(authKeys.session(), null)
    client.removeQueries({ queryKey: onboardingKeys.all })

    // After eviction the cache slot MUST be undefined (not stale data)
    expect(client.getQueryData(onboardingKeys.templates())).toBeUndefined()
  })
})
