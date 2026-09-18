// ATDD RED-PHASE — Story 8-1b, Task 2 (dashboardKeys + useDashboard).
// AC3 — ONE page-level fetch via apiFetchWithMeta (NOT apiFetch): the hook MUST
// surface `meta.serverTime` alongside `data`, because every countdown / "N ago"
// / "live now" computation (D16) depends on the server clock. apiFetch drops
// meta — using it is the failure this test guards against.
//
// RED signal: `@/features/dashboard/api/useDashboard` and
// `@/features/dashboard/api/dashboardKeys` do not exist yet (TS2307). No
// `test.skip()` ([[reference_atdd_red_convention]]).
//
// ── SEAMS the dev must expose ──────────────────────────────────────────────
//   • dashboardKeys = { all: ['dashboard'] as const, data: () => [...all,'data'] as const }
//   • useDashboard(): useQuery({ queryKey: dashboardKeys.data(),
//       queryFn: () => apiFetchWithMeta<DashboardData, EnvelopeMeta>('/api/dashboard') })
//     → the query DATA is the { data, meta } envelope (meta.serverTime reachable).
//   • staleTime per FW-3 (30s default acceptable; document any override).
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
// RED: neither module exists yet.
import { useDashboard } from '@/features/dashboard/api/useDashboard'
import { dashboardKeys } from '@/features/dashboard/api/dashboardKeys'
import { FIXED_SERVER_TIME, studentHandlers } from '@/features/dashboard/api/__tests__/handlers'

function wrapper({ children }: { children: ReactNode }) {
  const client = createTestQueryClient()
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

afterEach(() => server.resetHandlers())

describe('dashboardKeys — TS-3 query-key factory', () => {
  test('P2 data() is a hierarchical const tuple under all', () => {
    expect(dashboardKeys.data()).toEqual(['dashboard', 'data'])
  })
})

describe('useDashboard — AC3 apiFetchWithMeta surfaces meta.serverTime', () => {
  test('P1 resolves with BOTH the role-scoped data block and meta.serverTime', async () => {
    server.use(...studentHandlers)
    const { result } = renderHook(() => useDashboard(), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    // The envelope must carry meta — the whole reason for apiFetchWithMeta.
    expect(result.current.data?.meta.serverTime).toBe(FIXED_SERVER_TIME)
    // …and the role-scoped payload.
    expect(result.current.data?.data.role).toBe('student')
    expect(result.current.data?.data.student).not.toBeNull()
    expect(result.current.data?.data.teacher).toBeNull()
    expect(result.current.data?.data.owner).toBeNull()
  })
})
