// Story 5.3 Task 3 (AC13, Sally S6) — the per-submission BroadcastChannel:
// tab-1 posts `submitted` → tab-2's onForeignSubmit fires; ECHO GUARD → the
// posting tab never fires its own; PRIVATE MODE → undefined channel, no throw.
// Uses the REAL BroadcastChannel (no mock) so the two hook instances actually
// talk, mirroring the multi-tab BLOCKER shape.
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { useAttemptBroadcast } from '../useAttemptBroadcast'

const SUB = 'sub-broadcast-1'

afterEach(() => vi.restoreAllMocks())

describe('useAttemptBroadcast (AC13)', () => {
  test('a submit in tab-1 fires onForeignSubmit in tab-2', async () => {
    const tab2Foreign = vi.fn()
    const tab1 = renderHook(() =>
      useAttemptBroadcast(SUB, { onForeignSubmit: vi.fn() }),
    )
    renderHook(() => useAttemptBroadcast(SUB, { onForeignSubmit: tab2Foreign }))

    tab1.result.current.postSubmitted()

    await waitFor(() => expect(tab2Foreign).toHaveBeenCalledTimes(1))
  })

  test('ECHO GUARD — the posting tab does not flip itself', async () => {
    const tab1Foreign = vi.fn()
    const tab1 = renderHook(() =>
      useAttemptBroadcast(SUB, { onForeignSubmit: tab1Foreign }),
    )
    tab1.result.current.postSubmitted()
    // Give any (incorrect) self-delivery a chance to fire.
    await new Promise((r) => setTimeout(r, 20))
    expect(tab1Foreign).not.toHaveBeenCalled()
  })

  test('PRIVATE MODE — undefined BroadcastChannel does not throw', () => {
    const original = globalThis.BroadcastChannel
    // @ts-expect-error — simulate Safari private mode where it is undefined.
    delete globalThis.BroadcastChannel
    try {
      const { result } = renderHook(() =>
        useAttemptBroadcast(SUB, { onForeignSubmit: vi.fn() }),
      )
      expect(() => result.current.postSubmitted()).not.toThrow()
    } finally {
      globalThis.BroadcastChannel = original
    }
  })
})
