// Story 3.1 (AC4/AC8) — optimistic transition + rollback (FW-2 triple).
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { classesKeys } from '../classesKeys'
import { useTransitionClassStatus } from '../useTransitionClassStatus'
import type { ClassWire } from '../useClasses'
import { classWire, DEFAULT_CENTER_ID } from './handlers'

function envelope<T>(data: T) {
  return { data, meta: { serverTime: '2026-07-19T00:00:00Z' } }
}

describe('useTransitionClassStatus — optimistic triple (FW-2)', () => {
  test('apply → 200 settles at the new status', async () => {
    const client = createTestQueryClient()
    const listKey = classesKeys.list(DEFAULT_CENTER_ID, 'all')
    client.setQueryData(listKey, [
      classWire({ id: 'cls-x', status: 'active' }),
    ])
    server.use(
      http.post('/api/classes/cls-x/status', () =>
        HttpResponse.json(envelope(classWire({ id: 'cls-x', status: 'paused' }))),
      ),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useTransitionClassStatus(DEFAULT_CENTER_ID),
      { wrapper },
    )

    result.current.mutate({ id: 'cls-x', status: 'paused' })

    // Optimistic: cache flips to paused before the server responds.
    await waitFor(() => {
      expect(client.getQueryData<ClassWire[]>(listKey)?.[0].status).toBe('paused')
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  test('apply → 422 rolls back to the LITERAL prior status', async () => {
    const client = createTestQueryClient()
    const listKey = classesKeys.list(DEFAULT_CENTER_ID, 'all')
    client.setQueryData(listKey, [
      classWire({ id: 'cls-y', status: 'active' }),
    ])
    server.use(
      http.post('/api/classes/cls-y/status', () =>
        HttpResponse.json(
          {
            error: {
              code: 'INVALID_STATUS_TRANSITION',
              message: 'not allowed',
              requestId: 'r-1',
              details: [{ field: 'status', code: 'INVALID_STATUS_TRANSITION' }],
            },
          },
          { status: 422 },
        ),
      ),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useTransitionClassStatus(DEFAULT_CENTER_ID),
      { wrapper },
    )

    result.current.mutate({ id: 'cls-y', status: 'paused' })

    await waitFor(() => expect(result.current.isError).toBe(true))
    // Rolled back to the exact prior status (no active list observer → the
    // onSettled invalidate does not refetch, so the snapshot stands).
    expect(client.getQueryData<ClassWire[]>(listKey)?.[0].status).toBe('active')
  })

  test('patches EVERY cached list scope a class appears in (owner + teacher)', async () => {
    const client = createTestQueryClient()
    const ownerKey = classesKeys.list(DEFAULT_CENTER_ID, 'all')
    const teacherKey = classesKeys.list(DEFAULT_CENTER_ID, 'teacher:user-teacher-a')
    const cls = classWire({ id: 'cls-z', status: 'active', teacherId: 'user-teacher-a' })
    client.setQueryData(ownerKey, [cls])
    client.setQueryData(teacherKey, [cls])
    server.use(
      http.post('/api/classes/cls-z/status', () =>
        HttpResponse.json(envelope(classWire({ id: 'cls-z', status: 'paused' }))),
      ),
    )
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => useTransitionClassStatus(DEFAULT_CENTER_ID),
      { wrapper },
    )

    result.current.mutate({ id: 'cls-z', status: 'paused' })

    await waitFor(() => {
      expect(client.getQueryData<ClassWire[]>(ownerKey)?.[0].status).toBe('paused')
      expect(client.getQueryData<ClassWire[]>(teacherKey)?.[0].status).toBe(
        'paused',
      )
    })
  })
})
