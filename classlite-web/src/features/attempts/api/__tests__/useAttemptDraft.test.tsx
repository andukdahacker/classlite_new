// Story 5.2b Task 3 (AC10/D9) → 5.2d Task (AC2). The GENERIC cache-resident
// draft slice: setContent full-replaces, seedAttemptDraft primes once without
// clobbering in-progress edits, and the slice survives remount because it is
// cache-resident. Driven by a synthetic non-quiz content shape. The quiz
// setAnswer/toggleFlag adapter is tested in quiz-attempt/api/useQuizDraft.test.
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '../attemptKeys'
import { seedAttemptDraft, useAttemptDraft } from '../useAttemptDraft'

interface Doc {
  schemaVersion: 1
  value: string
}
const empty = (): Doc => ({ schemaVersion: 1, value: '' })
const SUB = 'sub-1'

function wrapperFor(client = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useAttemptDraft (generic slice)', () => {
  test('setContent full-replaces the cache slice', () => {
    const { wrapper } = wrapperFor()
    const { result } = renderHook(() => useAttemptDraft<Doc>(SUB, empty), { wrapper })

    expect(result.current.content).toEqual({ schemaVersion: 1, value: '' })
    act(() => result.current.setContent((prev) => ({ ...prev, value: 'a' })))
    expect(result.current.content.value).toBe('a')
  })

  test('seedAttemptDraft primes once, then does NOT clobber edits', () => {
    const { client, wrapper } = wrapperFor()
    seedAttemptDraft<Doc>(client, SUB, { schemaVersion: 1, value: 'server' })
    const { result } = renderHook(() => useAttemptDraft<Doc>(SUB, empty), { wrapper })
    expect(result.current.content.value).toBe('server')

    // An edit lands…
    act(() => result.current.setContent((prev) => ({ ...prev, value: 'mine' })))
    // …a second seed (e.g. a remount re-running the effect) must NOT wipe it.
    act(() => seedAttemptDraft<Doc>(client, SUB, { schemaVersion: 1, value: '' }))
    expect(result.current.content.value).toBe('mine')
  })

  test('the draft survives a remount because it is cache-resident (D9)', () => {
    const { client, wrapper } = wrapperFor()
    const first = renderHook(() => useAttemptDraft<Doc>(SUB, empty), { wrapper })
    act(() => first.result.current.setContent((prev) => ({ ...prev, value: 'kept' })))
    first.unmount()

    // Re-mounting against the SAME client reads the same slice back.
    const second = renderHook(() => useAttemptDraft<Doc>(SUB, empty), { wrapper })
    expect(second.result.current.content.value).toBe('kept')

    const raw = client.getQueryData<Doc>(attemptKeys.draft(SUB))
    expect(raw?.value).toBe('kept')
  })
})
