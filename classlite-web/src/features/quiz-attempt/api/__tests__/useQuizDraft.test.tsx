// Story 5.2d (AC2) — the quiz draft adapter over the generic slice: setAnswer +
// toggleFlag full-replace into the cache slice, cache-resident across remount.
import { QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, test } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { attemptKeys } from '@/features/attempts'
import type { AttemptContent } from '../../lib/attemptContent'
import { useQuizDraft } from '../useQuizDraft'

const SUB = 'sub-1'

function wrapperFor(client = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

describe('useQuizDraft', () => {
  test('setAnswer + toggleFlag full-replace into the cache slice', () => {
    const { wrapper } = wrapperFor()
    const { result } = renderHook(() => useQuizDraft(SUB), { wrapper })

    expect(result.current.content.answers).toEqual({})
    act(() => result.current.setAnswer('0:0:0', 'true'))
    expect(result.current.content.answers).toEqual({ '0:0:0': 'true' })

    act(() => result.current.toggleFlag('0:0:0'))
    expect(result.current.content.flagged).toEqual(['0:0:0'])
    act(() => result.current.toggleFlag('0:0:0'))
    expect(result.current.content.flagged).toEqual([])
  })

  test('the draft survives a remount because it is cache-resident (D9)', () => {
    const { client, wrapper } = wrapperFor()
    const first = renderHook(() => useQuizDraft(SUB), { wrapper })
    act(() => first.result.current.setAnswer('0:0:0', 'kept'))
    first.unmount()

    const second = renderHook(() => useQuizDraft(SUB), { wrapper })
    expect(second.result.current.content.answers).toEqual({ '0:0:0': 'kept' })

    const raw = client.getQueryData<AttemptContent>(attemptKeys.draft(SUB))
    expect(raw?.answers).toEqual({ '0:0:0': 'kept' })
  })
})
