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
