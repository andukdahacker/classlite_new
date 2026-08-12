/**
 * Story 5.4 Task 3 (AC5,7,9,10,11) — useMediaRecorder unit tests against the
 * controllable media mock (the deliberate second seam; the recorder's real
 * behavior is the A5 gate). Covers codec variants, both failure modes, max-
 * duration auto-stop, and object-URL / track cleanup.
 */
import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { useMediaRecorder } from '../useMediaRecorder'
import { installMediaMocks, type MediaMockController } from '../../test/mockMediaRecorder'

let media: MediaMockController
let clock: number
const now = () => clock

beforeEach(() => {
  media = installMediaMocks()
  clock = 0
})
afterEach(() => {
  media.restore()
  vi.useRealTimers()
})

describe('codec selection (AC5)', () => {
  test('webm supported → records audio/webm + .webm', async () => {
    const { result } = renderHook(() => useMediaRecorder({ now }))
    expect(result.current.isSupported).toBe(true)
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('recording')
    clock = 5000
    act(() => result.current.stop())
    expect(result.current.status).toBe('recorded')
    expect(result.current.take?.contentType).toBe('audio/webm')
    expect(result.current.take?.ext).toBe('.webm')
    expect(result.current.take?.durationSec).toBe(5)
    expect(media.getUserMediaCalls()).toBe(1)
    expect(media.latestRecorder?.mimeType).toContain('webm')
  })

  test('webm unsupported, mp4 supported → records audio/mp4 + .m4a (iOS Safari)', async () => {
    media.setSupported((t) => t === 'audio/mp4')
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    clock = 3000
    act(() => result.current.stop())
    expect(result.current.take?.contentType).toBe('audio/mp4')
    expect(result.current.take?.ext).toBe('.m4a')
  })

  test('neither codec supported → unsupported error, ZERO getUserMedia', async () => {
    media.setSupported(() => false)
    const { result } = renderHook(() => useMediaRecorder({ now }))
    expect(result.current.isSupported).toBe(false)
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.errorKind).toBe('unsupported')
    expect(media.getUserMediaCalls()).toBe(0)
  })
})

describe('record-arm failure branching (AC10)', () => {
  test.each([
    ['NotAllowedError', 'permission-denied'],
    ['NotFoundError', 'no-device'],
    ['NotReadableError', 'device-busy'],
    ['AbortError', 'device-busy'],
  ])('%s → %s (never enters recording)', async (domName, expectedKind) => {
    media.rejectGetUserMedia(domName)
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.errorKind).toBe(expectedKind)
    expect(result.current.take).toBeNull()
  })
})

describe('mid-recording interruption (AC11)', () => {
  test('audio track ended → clean stop, partial dropped, interrupted panel', async () => {
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    act(() => {
      media.latestStream?.getAudioTracks()[0].emitEnded()
    })
    expect(result.current.status).toBe('error')
    expect(result.current.errorKind).toBe('interrupted')
    expect(result.current.take).toBeNull()
    expect(media.latestStream?.getTracks()[0].stopped).toBe(true)
  })

  test('MediaRecorder onerror → interrupted, no take', async () => {
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    act(() => media.latestRecorder?.emitError())
    expect(result.current.status).toBe('error')
    expect(result.current.errorKind).toBe('interrupted')
    expect(result.current.take).toBeNull()
  })
})

describe('max-duration auto-stop (AC7, D10)', () => {
  test('auto-stops at maxDurationSec so the 25 MB ceiling is never hit', async () => {
    vi.useFakeTimers()
    const { result } = renderHook(() => useMediaRecorder({ now, maxDurationSec: 2 }))
    await act(async () => {
      await result.current.start()
    })
    expect(result.current.status).toBe('recording')
    await act(async () => {
      clock = 2000
      vi.advanceTimersByTime(2000)
    })
    expect(result.current.status).toBe('recorded')
    expect(result.current.take).not.toBeNull()
  })
})

describe('cleanup (AC2/AC8)', () => {
  test('re-record revokes the prior object-URL and returns to idle', async () => {
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    clock = 4000
    act(() => result.current.stop())
    const url = result.current.take?.objectUrl
    act(() => result.current.reRecord())
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
    expect(result.current.status).toBe('idle')
    expect(result.current.take).toBeNull()
  })

  test('stop releases the mic tracks (MediaStreamTrack.stop)', async () => {
    const { result } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    act(() => result.current.stop())
    expect(media.latestStream?.getTracks()[0].stopped).toBe(true)
  })

  test('unmount revokes the current take object-URL', async () => {
    const { result, unmount } = renderHook(() => useMediaRecorder({ now }))
    await act(async () => {
      await result.current.start()
    })
    clock = 2000
    act(() => result.current.stop())
    const url = result.current.take?.objectUrl
    unmount()
    expect(URL.revokeObjectURL).toHaveBeenCalledWith(url)
  })
})
