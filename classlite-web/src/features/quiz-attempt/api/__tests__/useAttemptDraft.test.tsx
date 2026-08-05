// Story 5.2b Task 3 (AC10/D9) — the draft slice lives in the Query cache and
// survives remount; seedAttemptDraft primes from server content without
// clobbering in-progress edits.
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '../attemptKeys'
import { seedAttemptDraft, useAttemptDraft } from '../useAttemptDraft'
import type { AttemptContent } from '../../lib/attemptContent'

const SUB = 'sub-1'

function wrapperFor(client = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useAttemptDraft', () => {
  test('setAnswer + toggleFlag full-replace into the cache slice', () => {
    const { wrapper } = wrapperFor()
    const { result } = renderHook(() => useAttemptDraft(SUB), { wrapper })

    expect(result.current.content.answers).toEqual({})
    act(() => result.current.setAnswer('0:0:0', 'true'))
    expect(result.current.content.answers).toEqual({ '0:0:0': 'true' })

    act(() => result.current.toggleFlag('0:0:0'))
    expect(result.current.content.flagged).toEqual(['0:0:0'])
    act(() => result.current.toggleFlag('0:0:0'))
    expect(result.current.content.flagged).toEqual([])
  })

  test('seedAttemptDraft primes from server content, then does NOT clobber edits', () => {
    const { client, wrapper } = wrapperFor()
    seedAttemptDraft(client, SUB, {
      schemaVersion: 1,
      answers: { '0:0:0': 'server' },
      flagged: [],
    })
    const { result } = renderHook(() => useAttemptDraft(SUB), { wrapper })
    expect(result.current.content.answers).toEqual({ '0:0:0': 'server' })

    // An edit lands…
    act(() => result.current.setAnswer('0:0:1', 'mine'))
    // …a second seed (e.g. a remount re-running the effect) must NOT wipe it.
    act(() => seedAttemptDraft(client, SUB, { schemaVersion: 1, answers: {}, flagged: [] }))
    expect(result.current.content.answers).toEqual({
      '0:0:0': 'server',
      '0:0:1': 'mine',
    })
  })

  test('the draft survives a remount because it is cache-resident (D9)', () => {
    const { client, wrapper } = wrapperFor()
    const first = renderHook(() => useAttemptDraft(SUB), { wrapper })
    act(() => first.result.current.setAnswer('0:0:0', 'kept'))
    first.unmount()

    // Re-mounting against the SAME client reads the same slice back.
    const second = renderHook(() => useAttemptDraft(SUB), { wrapper })
    expect(second.result.current.content.answers).toEqual({ '0:0:0': 'kept' })

    const raw = client.getQueryData<AttemptContent>(attemptKeys.draft(SUB))
    expect(raw?.answers).toEqual({ '0:0:0': 'kept' })
  })
})
