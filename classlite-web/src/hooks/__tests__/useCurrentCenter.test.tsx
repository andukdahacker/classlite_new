/**
 * useCurrentCenter — Story 2-3a AC9 Task 4.4.
 *
 * Selector over `useAuth().session?.center`. Verifies the 3 cases: no session,
 * session with `center: null`, session with a populated center.
 */
import { describe, expect, test } from 'vitest'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import {
  authKeys,
  type CenterSummary,
  type Session,
} from '@/features/auth/api/authKeys'
import { createTestQueryClient } from '@/lib/query-client'
import { useCurrentCenter } from '@/hooks/useCurrentCenter'

function makeWrapper(client = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

const stubUser: Session['user'] = {
  id: 'user-1',
  email: 'alice@example.com',
  fullName: 'Alice Tran',
  emailVerified: true,
}

describe('useCurrentCenter — Story 2-3a AC9', () => {
  test('returns null when no session is cached', () => {
    const { wrapper } = makeWrapper()
    const { result } = renderHook(() => useCurrentCenter(), { wrapper })
    expect(result.current).toBeNull()
  })

  test('returns null when session exists but center is null', () => {
    const { client, wrapper } = makeWrapper()
    client.setQueryData<Session>(authKeys.session(), {
      user: stubUser,
      accessToken: 'jwt.access',
      center: null,
    })
    const { result } = renderHook(() => useCurrentCenter(), { wrapper })
    expect(result.current).toBeNull()
  })

  test('returns the populated center summary', () => {
    const center: CenterSummary = {
      id: 'center-1',
      name: 'Saigon English Center',
      shortCode: 'saigon-english-center',
      // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
      brandColor: '#1e3a8a',
      logoUrl: null,
      timezone: 'Asia/Ho_Chi_Minh',
    }
    const { client, wrapper } = makeWrapper()
    client.setQueryData<Session>(authKeys.session(), {
      user: stubUser,
      accessToken: 'jwt.access',
      center,
    })
    const { result } = renderHook(() => useCurrentCenter(), { wrapper })
    expect(result.current).toEqual(center)
    // The migrated shape exposes `shortCode` (NOT `slug`).
    expect(result.current).toHaveProperty('shortCode', 'saigon-english-center')
  })
})
