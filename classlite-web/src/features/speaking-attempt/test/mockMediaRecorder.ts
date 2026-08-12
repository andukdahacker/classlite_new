/**
 * Controllable MediaRecorder / getUserMedia / MediaStream test doubles for the
 * speaking recorder (Story 5.4). jsdom ships none of these, and the recorder's
 * REAL behavior lives on the A5 real-device gate (not CI — Murat), so this is a
 * DELIBERATE second mock seam alongside MSW. `stop()` auto-fires one
 * `dataavailable` + `stop` so the happy flow completes without manual driving;
 * tests can still reach into `controller.latestRecorder` / `controller.latestStream`
 * to drive interruption (`emitError` / track `emitEnded`) and codec variants.
 */
import { vi } from 'vitest'

export class FakeMediaStreamTrack {
  kind = 'audio'
  readyState: 'live' | 'ended' = 'live'
  stopped = false
  private listeners: Record<string, Array<() => void>> = {}

  addEventListener(type: string, cb: () => void): void {
    ;(this.listeners[type] ??= []).push(cb)
  }

  removeEventListener(type: string, cb: () => void): void {
    this.listeners[type] = (this.listeners[type] ?? []).filter((l) => l !== cb)
  }

  stop(): void {
    this.stopped = true
    this.readyState = 'ended'
  }

  /** Simulate the OS seizing the mic mid-take (AC11). */
  emitEnded(): void {
    this.readyState = 'ended'
    ;(this.listeners.ended ?? []).forEach((cb) => cb())
  }
}

export class FakeMediaStream {
  private tracks: FakeMediaStreamTrack[]
  constructor() {
    this.tracks = [new FakeMediaStreamTrack()]
  }
  getTracks(): FakeMediaStreamTrack[] {
    return this.tracks
  }
  getAudioTracks(): FakeMediaStreamTrack[] {
    return this.tracks
  }
}

export interface MediaMockController {
  latestRecorder: FakeMediaRecorder | null
  latestStream: FakeMediaStream | null
  recorders: FakeMediaRecorder[]
  /** Configure which recorder MIME types report supported (default: webm). */
  setSupported: (predicate: (mimeType: string) => boolean) => void
  /** Make the next getUserMedia reject with a DOMException of this name. */
  rejectGetUserMedia: (name: string) => void
  /** getUserMedia call count (proves "zero getUserMedia" absent-verification). */
  getUserMediaCalls: () => number
  restore: () => void
}

let supportedPredicate: (mimeType: string) => boolean = (t) => t.includes('webm')

export class FakeMediaRecorder {
  static isTypeSupported = (mimeType: string): boolean => supportedPredicate(mimeType)

  state: 'inactive' | 'recording' | 'paused' = 'inactive'
  mimeType: string
  stream: FakeMediaStream
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  onerror: ((event: unknown) => void) | null = null

  constructor(
    stream: FakeMediaStream,
    options?: { mimeType?: string; audioBitsPerSecond?: number },
  ) {
    this.stream = stream
    this.mimeType = options?.mimeType ?? ''
  }

  start(): void {
    this.state = 'recording'
  }

  stop(): void {
    if (this.state === 'inactive') return
    this.state = 'inactive'
    // Auto-fire a single data chunk + stop so the happy path completes.
    this.ondataavailable?.({ data: new Blob(['audio-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  }

  /** Drive a mid-recording MediaRecorder error (AC11). */
  emitError(): void {
    this.onerror?.({})
  }
}

/**
 * Install the controllable media mocks onto the global scope. Call in a test's
 * `beforeEach`; call the returned `restore()` in `afterEach`.
 */
export function installMediaMocks(): MediaMockController {
  supportedPredicate = (t) => t.includes('webm')
  const recorders: FakeMediaRecorder[] = []
  let latestStream: FakeMediaStream | null = null
  let rejectName: string | null = null
  let gumCalls = 0

  const originalMediaRecorder = globalThis.MediaRecorder
  const originalMediaDevices = navigator.mediaDevices
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL

  // Patch the constructor so we can capture instances.
  class TrackingRecorder extends FakeMediaRecorder {
    constructor(stream: FakeMediaStream, options?: { mimeType?: string }) {
      super(stream, options)
      recorders.push(this)
    }
  }
  globalThis.MediaRecorder = TrackingRecorder as unknown as typeof MediaRecorder

  const getUserMedia = vi.fn(async () => {
    gumCalls += 1
    if (rejectName !== null) {
      const name = rejectName
      rejectName = null
      throw new DOMException('simulated getUserMedia rejection', name)
    }
    latestStream = new FakeMediaStream()
    return latestStream as unknown as MediaStream
  })
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia },
  })

  let urlCounter = 0
  URL.createObjectURL = vi.fn(() => `blob:mock/${++urlCounter}`)
  URL.revokeObjectURL = vi.fn()

  return {
    get latestRecorder() {
      return recorders.length > 0 ? recorders[recorders.length - 1] : null
    },
    get latestStream() {
      return latestStream
    },
    recorders,
    setSupported(predicate) {
      supportedPredicate = predicate
    },
    rejectGetUserMedia(name) {
      rejectName = name
    },
    getUserMediaCalls: () => gumCalls,
    restore() {
      globalThis.MediaRecorder = originalMediaRecorder
      Object.defineProperty(navigator, 'mediaDevices', {
        configurable: true,
        value: originalMediaDevices,
      })
      URL.createObjectURL = originalCreate
      URL.revokeObjectURL = originalRevoke
      supportedPredicate = (t) => t.includes('webm')
    },
  }
}
