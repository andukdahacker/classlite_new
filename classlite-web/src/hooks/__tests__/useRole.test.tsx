/**
 * useRole — Story 2.6 (AC3) graduated hook.
 *
 * 4-cell matrix over (session-cache role × RoleContext override):
 *   1. session=null,        override=null       → null
 *   2. session.role='owner', override=null      → 'owner'
 *   3. session=null,        override='teacher'  → 'teacher' (override wins)
 *   4. session.role='owner', override='teacher' → 'teacher' (override wins)
 *
 * Mock seam: TEST-FE-1 — no MSW needed; hook only reads the session
 * cache slot via useAuth. Tests seed the cache directly.
 */
import { describe, expect, test } from 'vitest'
import { renderHook } from '@testing-library/react'
import { beforeEach, afterEach } from 'vitest'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createElement, type ReactNode } from 'react'
import { useRole } from '@/hooks/useRole'
import { RoleProvider } from '@/hooks/RoleContext'
import {
  authKeys,
  type Session,
  type UserSummary,
} from '@/features/auth/api/authKeys'
import { queryClient as moduleQueryClient } from '@/lib/query-client'

const STUB_USER: UserSummary = {
  id: 'u-1',
  email: 'trang@example.com',
  fullName: 'Trang',
  emailVerified: true,
}

// useRole/useRoleLoading (Story 2.6 Task 6.3) subscribe to the module-
// singleton queryClient, NOT the per-test QueryClient. Seed the singleton
// so the hook observes the value under test — mirrors useAuth.test.tsx.
function makeClient(session: Session | null): QueryClient {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
  if (session) {
    moduleQueryClient.setQueryData<Session>(authKeys.session(), session)
  } else {
    moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
  }
  return client
}

beforeEach(() => {
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})
afterEach(() => {
  moduleQueryClient.removeQueries({ queryKey: authKeys.session() })
})

function makeWrapper(client: QueryClient, override: Session['role'] | 'no-provider') {
  return function Wrapper({ children }: { children: ReactNode }) {
    const inner =
      override === 'no-provider'
        ? children
        : createElement(RoleProvider, { value: override, children })
    return createElement(QueryClientProvider, { client }, inner)
  }
}

describe('useRole — Story 2.6 AC3 matrix', () => {
  test('session null + no context override → returns null', () => {
    const wrapper = makeWrapper(makeClient(null), 'no-provider')
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current).toBeNull()
  })

  test('session.role=owner + no context override → returns "owner"', () => {
    const wrapper = makeWrapper(
      makeClient({
        user: STUB_USER,
        accessToken: 'a.b.c',
        center: null,
        role: 'owner',
      }),
      'no-provider',
    )
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current).toBe('owner')
  })

  test('session null + RoleContext=teacher → override wins', () => {
    const wrapper = makeWrapper(makeClient(null), 'teacher')
    const { result } = renderHook(() => useRole(), { wrapper })
    expect(result.current).toBe('teacher')
  })

  test('session.role=owner + RoleContext=teacher → override wins', () => {
    const wrapper = makeWrapper(
      makeClient({
        user: STUB_USER,
        accessToken: 'a.b.c',
        center: null,
        role: 'owner',
      }),
      'teacher',
    )
    const { result } = renderHook(() => useRole(), { wrapper })
    // Storybook / test seam wins so a story can render a Teacher view
    // even against an Owner-seeded cache.
    expect(result.current).toBe('teacher')
  })
})
