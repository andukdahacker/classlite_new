// Story 4.4b (review P1, FW-2) — optimistic-rollback regression for the folder
// mutation triple: a server-rejected mutation must restore the pre-mutation
// snapshot (not leave the optimistic paint stuck). MSW at the HTTP boundary,
// real QueryClient — never mock Query (TEST-FE-1).
import { type ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http, delay } from 'msw'
import { afterEach, describe, expect, test } from 'vitest'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { knowledgeHubKeys } from '@/features/knowledge-hub/api/knowledgeHubKeys'
import { useUpdateFolder, type FolderWire } from '@/features/knowledge-hub/api/foldersApi'
import { CENTER_ID, folder } from './harness'

afterEach(() => server.resetHandlers())

describe('foldersApi optimistic rollback (FW-2)', () => {
  test('a server-rejected folder rename paints optimistically then rolls back to the snapshot', async () => {
    const client = createTestQueryClient()
    const key = knowledgeHubKeys.folders(CENTER_ID)
    client.setQueryData<FolderWire[]>(key, [folder({ id: 'fold-1', name: 'Old', parentFolderId: null })])
    const nameInCache = (): string | undefined =>
      client.getQueryData<FolderWire[]>(key)?.[0]?.name

    // A delayed 422 (cycle) so the optimistic 'New' paint is observable before
    // the rejection rolls it back.
    server.use(
      http.patch('/api/knowledge-hub/folders/fold-1', async () => {
        await delay(50)
        return HttpResponse.json(
          { error: { code: 'FOLDER_CYCLE', message: 'cycle', requestId: 'r' } },
          { status: 422 },
        )
      }),
    )

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateFolder(CENTER_ID), { wrapper })

    result.current.mutate({ id: 'fold-1', body: { name: 'New' } })

    // Optimistic triple, step 1: the cache flips to 'New' before the server answers.
    await waitFor(() => expect(nameInCache()).toBe('New'))
    // Step 2+3: the 422 rolls the snapshot back to 'Old'.
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(nameInCache()).toBe('Old')
  })
})
