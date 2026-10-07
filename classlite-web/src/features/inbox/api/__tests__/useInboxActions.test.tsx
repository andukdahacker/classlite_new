/**
 * useInboxActions — Story 10-1b AC5 (optimistic triple over list + count).
 *
 * MSW at the HTTP boundary (TEST-FE-1); the hook's optimistic cache math is the
 * unit under test. Pins the party-mode hardenings (Winston/Murat): rollback-on-404
 * restores BOTH keys, the count floors at 0, a double mark-read nets ONE decrement,
 * and archive defers its commit behind an undo window.
 */
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'

import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'
import type { components } from '@/lib/api/client'

import { inboxKeys, type InboxListParams } from '../inboxKeys'
import type { InboxListResult } from '../useInbox'
import type { UnreadCount } from '../useInboxCount'
import { ARCHIVE_UNDO_WINDOW_MS, useInboxActions } from '../useInboxActions'

type Notification = components['schemas']['Notification']

const LIST_PARAMS: InboxListParams = { page: 1, pageSize: 20 }

function notif(id: string, readAt: string | null): Notification {
  return {
    id,
    type: 'grade_released',
    title: 't',
    body: 'b',
    link: '/x',
    metadata: { schemaVersion: 1 },
    readAt,
    archivedAt: null,
    createdAt: '2026-10-07T12:00:00Z',
  }
}

function seed(client: ReturnType<typeof createTestQueryClient>, items: Notification[], unread: number) {
  const result: InboxListResult = {
    items,
    pagination: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
    serverTime: '2026-10-07T12:00:00Z',
  }
  client.setQueryData(inboxKeys.list(LIST_PARAMS), result)
  client.setQueryData<UnreadCount>(inboxKeys.count(), { unread })
}

function readList(client: ReturnType<typeof createTestQueryClient>): InboxListResult | undefined {
  return client.getQueryData<InboxListResult>(inboxKeys.list(LIST_PARAMS))
}
function readCount(client: ReturnType<typeof createTestQueryClient>): number | undefined {
  return client.getQueryData<UnreadCount>(inboxKeys.count())?.unread
}

function makeWrapper(client: ReturnType<typeof createTestQueryClient>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => server.resetHandlers())

describe('useInboxActions — markRead (AC5)', () => {
  test('optimistically flips readAt and decrements the count', async () => {
    server.use(http.post('/api/inbox/:id/read', () => HttpResponse.json({ data: { id: 'n1', status: 'read' } })))
    const client = createTestQueryClient()
    seed(client, [notif('n1', null), notif('n2', '2026-10-07T11:00:00Z')], 1)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    act(() => result.current.markRead('n1'))

    expect(readList(client)?.items.find((n) => n.id === 'n1')?.readAt).not.toBeNull()
    expect(readCount(client)).toBe(0)
  })

  test('a 404 rolls BOTH the list and the count back (two-key ctx)', async () => {
    server.use(
      http.post('/api/inbox/:id/read', () =>
        HttpResponse.json({ error: { code: 'NOTIFICATION_NOT_FOUND', message: 'x', requestId: 'r' } }, { status: 404 }),
      ),
    )
    const client = createTestQueryClient()
    seed(client, [notif('n1', null)], 3)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    await act(async () => {
      result.current.markRead('n1')
      await waitFor(() => expect(readCount(client)).toBe(3))
    })
    // list restored too — the row is unread again.
    expect(readList(client)?.items.find((n) => n.id === 'n1')?.readAt).toBeNull()
  })

  test('the optimistic count never renders negative (floored at 0)', () => {
    server.use(http.post('/api/inbox/:id/read', () => HttpResponse.json({ data: { id: 'n1', status: 'read' } })))
    const client = createTestQueryClient()
    // count is already 0 but the row is unread (a racing poll underflow scenario).
    seed(client, [notif('n1', null)], 0)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    act(() => result.current.markRead('n1'))

    expect(readCount(client)).toBe(0)
  })

  test('a rapid double mark-read nets ONE decrement', () => {
    server.use(http.post('/api/inbox/:id/read', () => HttpResponse.json({ data: { id: 'n1', status: 'read' } })))
    const client = createTestQueryClient()
    seed(client, [notif('n1', null)], 2)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    act(() => {
      result.current.markRead('n1')
      result.current.markRead('n1')
    })

    expect(readCount(client)).toBe(1)
  })
})

describe('useInboxActions — markAllRead (AC6)', () => {
  test('optimistically flips every row and zeroes the count', () => {
    server.use(http.post('/api/inbox/read-all', () => HttpResponse.json({ data: { status: 'ok' } })))
    const client = createTestQueryClient()
    seed(client, [notif('n1', null), notif('n2', null)], 2)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    act(() => result.current.markAllRead())

    expect(readList(client)?.items.every((n) => n.readAt != null)).toBe(true)
    expect(readCount(client)).toBe(0)
  })
})

describe('useInboxActions — archive deferred-commit + undo (AC5 / DD5)', () => {
  test('drops the row + decrements immediately; undo restores both and fires NO server call', () => {
    vi.useFakeTimers()
    let archiveCalls = 0
    server.use(
      http.post('/api/inbox/:id/archive', () => {
        archiveCalls += 1
        return HttpResponse.json({ data: { id: 'n1', status: 'archived' } })
      }),
    )
    const client = createTestQueryClient()
    seed(client, [notif('n1', null), notif('n2', null)], 2)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    let handle!: { undo: () => void }
    act(() => {
      handle = result.current.archive('n1')
    })
    // optimistic: row gone, count decremented.
    expect(readList(client)?.items.find((n) => n.id === 'n1')).toBeUndefined()
    expect(readCount(client)).toBe(1)

    // undo BEFORE the window elapses → restore, no server call.
    act(() => handle.undo())
    expect(readList(client)?.items.find((n) => n.id === 'n1')).toBeDefined()
    expect(readCount(client)).toBe(2)

    act(() => vi.advanceTimersByTime(ARCHIVE_UNDO_WINDOW_MS + 100))
    expect(archiveCalls).toBe(0)
    vi.useRealTimers()
  })

  test('commits the archive to the server once the undo window elapses', async () => {
    vi.useFakeTimers()
    let archiveCalls = 0
    server.use(
      http.post('/api/inbox/:id/archive', () => {
        archiveCalls += 1
        return HttpResponse.json({ data: { id: 'n1', status: 'archived' } })
      }),
    )
    const client = createTestQueryClient()
    seed(client, [notif('n1', null)], 1)
    const { result } = renderHook(() => useInboxActions(), { wrapper: makeWrapper(client) })

    act(() => {
      result.current.archive('n1')
    })
    await act(async () => {
      vi.advanceTimersByTime(ARCHIVE_UNDO_WINDOW_MS + 100)
    })
    vi.useRealTimers()
    await waitFor(() => expect(archiveCalls).toBe(1))
  })
})
