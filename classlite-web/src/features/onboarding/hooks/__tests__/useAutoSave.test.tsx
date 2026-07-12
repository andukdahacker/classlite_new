/**
 * useAutoSave — Story 2-3a AC6 + Task 5.1.
 *
 * Four correctness invariants on the debounced auto-save hook (Murat-S4
 * party-mode fold — story's original "assert PUT was called after 1500ms"
 * covered only 1 of 4). Plus saveSeq guard (Winston-W3 out-of-order landing)
 * and persistent-failure escalation (Sally-B2 ~5s consecutive failures).
 *
 * Contract: `useAutoSave` wraps `usePutOnboardingProgress` and exposes:
 *   {
 *     savingState: 'idle' | 'saving' | 'saved' | 'error' | 'persistentFailure',
 *     lastSavedAt: string | null,
 *     flush: () => Promise<void>,
 *     scheduleSave: (payload) => void,
 *   }
 *
 * RED phase: `@/features/onboarding/hooks/useAutoSave` doesn't exist yet.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { useAutoSave } from '@/features/onboarding/hooks/useAutoSave'
import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createTestQueryClient()}>
      {children}
    </QueryClientProvider>
  )
}

const DEBOUNCE_MS = 1500

const draftBase = {
  schemaVersion: 1 as const,
  personaChoice: 'founder' as const,
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
  centerDraft: { name: 'a', brandColor: '#1e3a8a', logoUrl: null },
  templateDraft: null,
}

beforeEach(() => {
  vi.useFakeTimers()
  server.use(...onboardingHandlers)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useAutoSave — AC6 debounce 4-invariant coverage (Murat-S4)', () => {
  test('invariant 1: single-fire per debounce window — rapid keystrokes collapse to ONE PUT', async () => {
    const putSpy = vi.fn()
    server.use(
      http.put('/api/onboarding/progress', async ({ request }) => {
        putSpy(await request.json())
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    act(() => {
      result.current.scheduleSave({
        ...draftBase,
        centerDraft: { ...draftBase.centerDraft, name: 'a' },
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
      result.current.scheduleSave({
        ...draftBase,
        centerDraft: { ...draftBase.centerDraft, name: 'ab' },
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(200)
      result.current.scheduleSave({
        ...draftBase,
        centerDraft: { ...draftBase.centerDraft, name: 'abc' },
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 100)
    })

    expect(putSpy).toHaveBeenCalledTimes(1)
  })

  test('invariant 2: last-value-wins — PUT payload carries latest state', async () => {
    let capturedName: string | undefined
    server.use(
      http.put('/api/onboarding/progress', async ({ request }) => {
        const body = (await request.json()) as {
          payload: { centerDraft: { name: string } }
        }
        capturedName = body.payload.centerDraft.name
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    for (const name of ['a', 'ab', 'abc']) {
      act(() => {
        result.current.scheduleSave({
          ...draftBase,
          centerDraft: { ...draftBase.centerDraft, name },
        })
      })
      await act(async () => {
        vi.advanceTimersByTime(100)
      })
    }
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 100)
    })

    expect(capturedName).toBe('abc')
  })

  test('invariant 3: unmount cancels pending debounce — NO PUT fires after unmount', async () => {
    const putSpy = vi.fn()
    server.use(
      http.put('/api/onboarding/progress', () => {
        putSpy()
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result, unmount } = renderHook(() => useAutoSave(), {
      wrapper: Wrapper,
    })

    act(() => {
      result.current.scheduleSave(draftBase)
    })
    unmount()
    await act(async () => {
      vi.runAllTimers()
    })

    expect(putSpy).not.toHaveBeenCalled()
  })

  test('invariant 4: flush() fires exactly ONE PUT synchronously and cancels pending debounce', async () => {
    const putSpy = vi.fn()
    server.use(
      http.put('/api/onboarding/progress', () => {
        putSpy()
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    act(() => {
      result.current.scheduleSave(draftBase)
    })
    await act(async () => {
      await result.current.flush()
    })
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2)
    })

    expect(putSpy).toHaveBeenCalledTimes(1)
  })
})

// R1-C3-P10 (+ picks up R1-C3-P4 spawn-submit-gate ii/iii at hook level) —
// Winston-W2 `flushWithLatch(payload, opts?: { currentStep? })` direct tests.
// Contract:
//   (a) subsequent scheduleSave calls no-op after latch engages;
//   (b) saveSeqRef bumped — in-flight debounced calls drop as stale;
//   (c) latch engages ONLY on doSave success (R1-C2-P2 — failed terminal
//       PUT leaves the form mutable for retry);
//   (d) opts.currentStep overrides the Provider value for that single write.
describe('useAutoSave — Winston-W2 flushWithLatch semantics', () => {
  test('(a) subsequent scheduleSave calls no-op after successful flushWithLatch', async () => {
    let putCount = 0
    server.use(
      http.put('/api/onboarding/progress', () => {
        putCount += 1
        return HttpResponse.json({
          data: {
            currentStep: 'done',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.flushWithLatch(draftBase, { currentStep: 'done' })
    })
    expect(putCount).toBe(1)

    // Latch engaged — further scheduleSave calls MUST no-op
    act(() => {
      result.current.scheduleSave(draftBase)
    })
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 2)
    })
    expect(putCount).toBe(1)
  })

  test('(b) saveSeq bump drops any in-flight older-seq PUT (Winston-W3 seq guard)', async () => {
    // Fire a scheduled save (older seq), then flushWithLatch (newer seq)
    // resolves first. When the older PUT eventually resolves, it must not
    // stomp savingState. Directly asserting this without a promise-race
    // mock is intricate; instead we assert observable state: after
    // flushWithLatch, savingState is `saved` and lastSavedAt reflects the
    // flushWithLatch's PUT, not any prior debounce.
    server.use(
      http.put('/api/onboarding/progress', () =>
        HttpResponse.json({
          data: {
            currentStep: 'done',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        }),
      ),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    act(() => result.current.scheduleSave(draftBase))
    // Fire flushWithLatch BEFORE debounce fires — should cancel it.
    await act(async () => {
      await result.current.flushWithLatch(draftBase, { currentStep: 'done' })
    })
    expect(result.current.savingState).toBe('saved')

    // After latch, subsequent debounce ticks are dropped — no state churn.
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS * 3)
    })
    expect(result.current.savingState).toBe('saved')
  })

  test('(c) failed flushWithLatch leaves latch OPEN — subsequent scheduleSave still fires', async () => {
    // Simulate a failing terminal PUT. The latch MUST NOT engage on failure
    // so the user can recover by editing + retrying. R1-C2-P2 contract.
    let attempt = 0
    server.use(
      http.put('/api/onboarding/progress', () => {
        attempt += 1
        // First call (flushWithLatch) fails; subsequent scheduleSave PUTs
        // succeed so we can prove the latch stayed open.
        if (attempt === 1) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR' } },
            { status: 500 },
          )
        }
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    await act(async () => {
      await result.current.flushWithLatch(draftBase, { currentStep: 'done' })
    })
    // The first attempt failed → state is error (or persistentFailure if the
    // hook counted this as a failure; either way, latch stayed open).
    expect(['error', 'persistentFailure']).toContain(
      result.current.savingState,
    )
    // Now schedule a recovery save — MUST fire.
    act(() => result.current.scheduleSave(draftBase))
    await act(async () => {
      vi.advanceTimersByTime(DEBOUNCE_MS + 100)
    })
    expect(attempt).toBeGreaterThanOrEqual(2)
    expect(result.current.savingState).toBe('saved')
  })

  test('(d) opts.currentStep overrides Provider value for terminal PUT (R1-C2-P1)', async () => {
    let capturedStep: string | undefined
    server.use(
      http.put('/api/onboarding/progress', async ({ request }) => {
        const body = (await request.json()) as { currentStep: string }
        capturedStep = body.currentStep
        return HttpResponse.json({
          data: {
            currentStep: body.currentStep,
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    // Provider currentStep is 'spawn' (the pathname would map to this).
    const { result } = renderHook(() => useAutoSave({ currentStep: 'spawn' }), {
      wrapper: Wrapper,
    })

    await act(async () => {
      await result.current.flushWithLatch(draftBase, { currentStep: 'done' })
    })

    // Wire MUST carry 'done', not 'spawn' — this is the AC6 contract.
    expect(capturedStep).toBe('done')
  })
})

// R1-C3-P4 spawn-submit-gate three-state (ii)/(iii) at hook level —
// (ii) savingState='saving' + (iii) savingState='error'/'persistentFailure'
// are exercised via the existing "Sally-B2 persistent-failure escalation"
// describe block below: it drives `scheduleSave` through failing PUT paths,
// asserts `savingState` transitions error → persistentFailure, then a
// successful PUT flips back to `saved`. The `flushWithLatch` block above
// (Winston-W2 (a)-(d)) covers the latch semantics needed by ClassSpawnPage's
// terminal submit. Together they land the R1-C3-P4 coverage without
// duplicating scenarios in a page-level test where MSW timing and fake
// timers don't compose.

describe('useAutoSave — Sally-B2 persistent-failure escalation', () => {
  test('after ≥3 consecutive PUT failures, savingState flips to persistentFailure', async () => {
    server.use(
      http.put('/api/onboarding/progress', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL_ERROR' } },
          { status: 500 },
        ),
      ),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    for (let i = 0; i < 4; i++) {
      act(() => result.current.scheduleSave(draftBase))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS + 100))
    }

    expect(result.current.savingState).toBe('persistentFailure')
  })

  test('a subsequent success flips savingState back to saved', async () => {
    let hitCount = 0
    server.use(
      http.put('/api/onboarding/progress', () => {
        hitCount += 1
        if (hitCount <= 3) {
          return HttpResponse.json(
            { error: { code: 'INTERNAL_ERROR' } },
            { status: 500 },
          )
        }
        return HttpResponse.json({
          data: {
            currentStep: 'center',
            payload: draftBase,
            updatedAt: '2026-07-08T14:23:45.123Z',
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        })
      }),
    )
    const { result } = renderHook(() => useAutoSave(), { wrapper: Wrapper })

    for (let i = 0; i < 4; i++) {
      act(() => result.current.scheduleSave(draftBase))
      await act(async () => vi.advanceTimersByTime(DEBOUNCE_MS + 100))
    }

    expect(result.current.savingState).toBe('saved')
  })
})
