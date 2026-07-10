/**
 * useCreateCenter — Story 2-3a AC7 + AC9 + Task 3.5.
 *
 * On 201 success, `useCreateCenter.onSuccess` MUST:
 *   1. Write `Session.center` slot with the 6 CenterSummary fields.
 *   2. Bump `Session.accessToken` to the fresh JWT (with center+role claims).
 *   3. Invalidate `onboardingKeys.progress()` so next GET reflects new state.
 *
 * This test covers the cross-feature cache write path — the onboarding
 * mutation reaches into `authKeys.session()` cache slot owned by the auth
 * feature (Murat-S8 party-mode fold — under-specified in original story).
 *
 * RED phase: neither `useCreateCenter` nor `CenterSummary` type nor
 * `onboardingKeys` factory exist yet.
 */
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { useCreateCenter } from '@/features/onboarding/api/useCreateCenter'
import { onboardingKeys } from '@/features/onboarding/api/onboardingKeys'
import {
  defaultCreateCenterResult,
  onboardingHandlers,
} from '@/features/onboarding/api/__tests__/handlers'

const stubUser = {
  id: 'user-1',
  email: 'trang@example.com',
  fullName: 'Trang Tran',
  emailVerified: true,
} as unknown as Session['user']

function makeWrapper(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
  }
}

beforeEach(() => {
  server.use(...onboardingHandlers)
})

afterEach(() => {
  // resetHandlers is handled globally by vitest-setup.ts
})

describe('useCreateCenter — AC7 + AC9 cache-write contract', () => {
  test('on 201 success, writes Session.center slot with 6 fields + bumps accessToken', async () => {
    const client = createTestQueryClient()
    // Seed session with no center + stale accessToken (mimics post-login state).
    client.setQueryData<Session>(authKeys.session(), {
      user: stubUser,
      accessToken: 'stale.token',
      center: null,
    })

    const { result } = renderHook(() => useCreateCenter(), {
      wrapper: makeWrapper(client),
    })

    result.current.mutate({
      name: 'Saigon English Center',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
      brandColor: '#1e3a8a',
      logoUrl: null,
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    const session = client.getQueryData<Session>(authKeys.session())
    expect(session).toBeDefined()
    expect(session?.center).toEqual({
      id: defaultCreateCenterResult.id,
      name: 'Saigon English Center',
      shortCode: defaultCreateCenterResult.shortCode,
      brandColor: defaultCreateCenterResult.brandColor,
      logoUrl: defaultCreateCenterResult.logoUrl,
      timezone: defaultCreateCenterResult.timezone,
    })
    expect(session?.accessToken).toBe(defaultCreateCenterResult.accessToken)
    // user shape preserved
    expect(session?.user.id).toBe('user-1')
  })

  test('on 201 success, invalidates onboardingKeys.progress()', async () => {
    const client = createTestQueryClient()
    client.setQueryData<Session>(authKeys.session(), {
      user: stubUser,
      accessToken: null,
      center: null,
    })
    // Seed a stale progress cache entry.
    client.setQueryData(onboardingKeys.progress(), {
      currentStep: 'center',
      payload: null,
      updatedAt: null,
      persona: 'operator',
    })

    const { result } = renderHook(() => useCreateCenter(), {
      wrapper: makeWrapper(client),
    })

    result.current.mutate({
      name: 'Some Center',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
      brandColor: '#166534',
      logoUrl: null,
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // Cache is invalidated → the entry is marked stale.
    const state = client.getQueryState(onboardingKeys.progress())
    expect(state?.isInvalidated).toBe(true)
  })

  test('on error, does NOT touch session cache', async () => {
    const { server: mswServer } = await import('@/test/msw-server')
    const { errorHandlers } = await import(
      '@/features/onboarding/api/__tests__/handlers'
    )
    mswServer.use(errorHandlers.centerInternalError())

    const client = createTestQueryClient()
    const initial: Session = {
      user: stubUser,
      accessToken: 'unchanged.token',
      center: null,
    }
    client.setQueryData<Session>(authKeys.session(), initial)

    const { result } = renderHook(() => useCreateCenter(), {
      wrapper: makeWrapper(client),
    })

    result.current.mutate({
      name: 'X',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
      brandColor: '#1e3a8a',
      logoUrl: null,
    })
    await waitFor(() => expect(result.current.isError).toBe(true))

    const session = client.getQueryData<Session>(authKeys.session())
    expect(session).toEqual(initial)
  })
})
