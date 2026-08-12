/**
 * Story 5.4 Task 4 — useSpeakingUpload + useBeforeUnloadGuard wrapper tests.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { http, HttpResponse } from 'msw'
import { server } from '@/test/msw-server'
import { useSpeakingUpload } from '../useSpeakingUpload'
import { useBeforeUnloadGuard } from '../useBeforeUnloadGuard'
import type { RecordedTake } from '../useMediaRecorder'

const R2 = 'https://r2-mock.example.com'

function take(): RecordedTake {
  const blob = new Blob(['x'])
  Object.defineProperty(blob, 'size', { value: 1024 })
  return { blob, objectUrl: 'blob:x', durationSec: 5, contentType: 'audio/webm', ext: '.webm' }
}

function handlers(putStatus = 200): void {
  server.use(
    http.post('/api/uploads/presign', () =>
      HttpResponse.json({ data: { url: `${R2}/center/speaking/x.webm`, key: 'center/speaking/x.webm' } }),
    ),
    http.put(`${R2}/*`, () => new HttpResponse(null, { status: putStatus })),
    http.post('/api/uploads/confirm', () => HttpResponse.json({ data: { key: 'x' } })),
  )
}

describe('useSpeakingUpload', () => {
  beforeEach(() => vi.useRealTimers())
  afterEach(() => vi.useRealTimers())

  test('success → returns key, status success', async () => {
    handlers(200)
    const { result } = renderHook(() => useSpeakingUpload())
    let key: string | null = null
    await act(async () => {
      key = await result.current.upload(take())
    })
    expect(key).toBe('center/speaking/x.webm')
    expect(result.current.status).toBe('success')
  })

  test('total failure → returns null, status failed (Blob kept by caller)', async () => {
    // A non-retryable presign rejection (413 over-cap) fails on the first attempt
    // with no retry backoff, so the wrapper reports null + 'failed' and the caller
    // keeps the Blob in-memory (D2). The 1+3=4 retry-exhaustion count is pinned
    // separately in uploadSpeakingAudio.test.ts.
    handlers()
    server.use(
      http.post('/api/uploads/presign', () =>
        HttpResponse.json(
          { error: { code: 'FILE_TOO_LARGE', message: 'too large', requestId: null } },
          { status: 413 },
        ),
      ),
    )
    const { result } = renderHook(() => useSpeakingUpload())
    let key: string | null = 'sentinel'
    await act(async () => {
      key = await result.current.upload(take())
    })
    expect(key).toBeNull()
    expect(result.current.status).toBe('failed')
  })
})

describe('useBeforeUnloadGuard', () => {
  test('adds the listener only while active', () => {
    const addSpy = vi.spyOn(window, 'addEventListener')
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { rerender, unmount } = renderHook(({ active }) => useBeforeUnloadGuard(active), {
      initialProps: { active: false },
    })
    expect(addSpy).not.toHaveBeenCalledWith('beforeunload', expect.any(Function))

    rerender({ active: true })
    expect(addSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))

    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    addSpy.mockRestore()
    removeSpy.mockRestore()
  })
})
