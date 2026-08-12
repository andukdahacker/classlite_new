/**
 * useMediaRecorder — Story 5.4 Task 3 (AC2,5,7,9,10,11). The greenfield capture
 * hook: `getUserMedia({audio})` → `MediaRecorder` lifecycle, codec selection via
 * `pickAudioMimeType`, single-Blob assembly, max-duration auto-stop, an object-URL
 * preview (revoked on re-record/unmount), and full `MediaStreamTrack.stop()`
 * cleanup. It branches BOTH failure modes:
 *   - record-arm failure (AC10): permission-denied / no-device / device-busy
 *   - mid-recording interruption (AC11): `MediaRecorder.onerror` OR an audio
 *     track's `ended` event (an incoming call / Siri / another app seizes the mic)
 *     → stop cleanly, DROP the partial take, return to record-ready.
 *
 * Isolation (AC2, D6): the highest-frequency state (the ~60fps level meter and the
 * 1s elapsed timer) lives HERE, inside the recorder leaf that consumes this hook.
 * React only re-renders that leaf on these updates — never the shell — because the
 * shell subscribes to none of them (it receives only the settled take via a stable
 * callback). See SpeakingRecorderLeaf.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  pickAudioMimeType,
  SPEAKING_AUDIO_BITS_PER_SECOND,
  SPEAKING_MAX_DURATION_SEC,
  type CanonicalAudioMime,
} from '../lib/speakingContent'

/** The recorder state machine (AC7). */
export type RecorderStatus = 'idle' | 'requesting' | 'recording' | 'recorded' | 'error'

/**
 * The failure kinds surfaced to the panels (AC10 cold-arm + AC11 mid-take).
 * `unsupported` is the no-codec case (AC5); `unknown` catches an unmapped
 * DOMException so the generic fallback line still lands the student somewhere true.
 */
export type RecorderErrorKind =
  | 'permission-denied'
  | 'no-device'
  | 'device-busy'
  | 'interrupted'
  | 'unsupported'
  | 'unknown'

/** A completed, playable recording handed up to the shell for upload/submit. */
export interface RecordedTake {
  blob: Blob
  /** Object-URL for the native `<audio>` preview (revoked on re-record/unmount). */
  objectUrl: string
  durationSec: number
  /** The CANONICAL container MIME (from the picker, NEVER `blob.type`) — AC5. */
  contentType: CanonicalAudioMime
  /** The key/filename extension that follows the container. */
  ext: '.webm' | '.m4a'
}

export interface UseMediaRecorderOptions {
  /** Max recording seconds before auto-stop (defaults to the 25 MB-derived cap). */
  maxDurationSec?: number
  /** Requested audio bitrate (defaults to 128 kbps). */
  audioBitsPerSecond?: number
  /** Injectable monotonic clock for elapsed/duration (defaults to performance.now). */
  now?: () => number
  /** Injectable codec-support predicate (defaults to MediaRecorder.isTypeSupported). */
  isTypeSupported?: (mimeType: string) => boolean
}

export interface UseMediaRecorderResult {
  status: RecorderStatus
  /** Whole seconds elapsed while recording (soft length indicator, AC7). */
  elapsedSec: number
  /** 0..1 input level for the rAF meter (0 when Web Audio is unavailable). */
  level: number
  /** The settled take, or null before the first recording / after re-record. */
  take: RecordedTake | null
  errorKind: RecorderErrorKind | null
  /** True when at least one audio container can be recorded (AC5). */
  isSupported: boolean
  /** Arm the mic + start recording (AC7). Rejects internally into `errorKind`. */
  start: () => Promise<void>
  /** Stop a live recording → assembles the take (AC7). */
  stop: () => void
  /** Discard/revoke the current take and return to record-ready (AC9). */
  reRecord: () => void
}

function classifyArmError(error: unknown): RecorderErrorKind {
  const name =
    error !== null && typeof error === 'object' && 'name' in error
      ? String((error as { name: unknown }).name)
      : ''
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission-denied'
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no-device'
    case 'NotReadableError':
    case 'AbortError':
      return 'device-busy'
    default:
      return 'unknown'
  }
}

/**
 * @param options recorder tuning + test injectables.
 * @returns the recorder state machine + controls.
 */
export function useMediaRecorder(
  options: UseMediaRecorderOptions = {},
): UseMediaRecorderResult {
  const {
    maxDurationSec = SPEAKING_MAX_DURATION_SEC,
    audioBitsPerSecond = SPEAKING_AUDIO_BITS_PER_SECOND,
    now = () => performance.now(),
    isTypeSupported,
  } = options

  const isSupported = pickAudioMimeType(isTypeSupported) !== null

  const [status, setStatus] = useState<RecorderStatus>('idle')
  const [elapsedSec, setElapsedSec] = useState(0)
  const [level, setLevel] = useState(0)
  const [take, setTake] = useState<RecordedTake | null>(null)
  const [errorKind, setErrorKind] = useState<RecorderErrorKind | null>(null)

  // Imperative capture state kept in refs so the elapsed/rAF tick handlers never
  // re-arm on a state change (FW-4 — stable references).
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const startMsRef = useRef(0)
  const interruptedRef = useRef(false)
  const pickedRef = useRef<ReturnType<typeof pickAudioMimeType>>(null)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const rafRef = useRef<number | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const takeRef = useRef<RecordedTake | null>(null)
  // True only while mounted — guards state/hardware work after an unmount that
  // races an in-flight `getUserMedia` (privacy: the mic must never stay live).
  const mountedRef = useRef(true)
  // True from a `start()` that passed the guard until the take settles — blocks a
  // re-entrant `start()` (double-tap) from orphaning the first stream/interval.
  const busyRef = useRef(false)

  const clearElapsed = useCallback(() => {
    if (intervalRef.current !== null) {
      clearInterval(intervalRef.current)
      intervalRef.current = null
    }
  }, [])

  const stopMeter = useCallback(() => {
    if (rafRef.current !== null && typeof cancelAnimationFrame !== 'undefined') {
      cancelAnimationFrame(rafRef.current)
    }
    rafRef.current = null
    if (audioContextRef.current !== null) {
      void audioContextRef.current.close().catch(() => {})
      audioContextRef.current = null
    }
    setLevel(0)
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
    streamRef.current = null
  }, [])

  const startMeter = useCallback((stream: MediaStream) => {
    const Ctor =
      typeof window !== 'undefined'
        ? (window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext)
        : undefined
    if (Ctor === undefined || typeof requestAnimationFrame === 'undefined') return
    try {
      const context = new Ctor()
      audioContextRef.current = context
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 256
      source.connect(analyser)
      const buffer = new Uint8Array(analyser.frequencyBinCount)
      const loop = () => {
        analyser.getByteTimeDomainData(buffer)
        let sum = 0
        for (const sample of buffer) {
          const centered = (sample - 128) / 128
          sum += centered * centered
        }
        setLevel(Math.min(1, Math.sqrt(sum / buffer.length) * 2))
        rafRef.current = requestAnimationFrame(loop)
      }
      rafRef.current = requestAnimationFrame(loop)
    } catch {
      // Web Audio unavailable / blocked — the meter simply stays flat.
      stopMeter()
    }
  }, [stopMeter])

  const stop = useCallback(() => {
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }, [])

  // A mic seizure mid-take (AC11): drop the partial, clean up, record-ready panel.
  const handleInterruption = useCallback(() => {
    if (interruptedRef.current) return
    interruptedRef.current = true
    clearElapsed()
    stopMeter()
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') {
      recorder.stop() // onstop sees interruptedRef → drops the take
    } else {
      releaseStream()
      busyRef.current = false
      chunksRef.current = []
      setErrorKind('interrupted')
      setStatus('error')
    }
  }, [clearElapsed, stopMeter, releaseStream])

  const start = useCallback(async () => {
    // Re-entrancy guard (double-tap / a caller that didn't disable the control):
    // a second start() while arming or recording would orphan the first mic stream
    // and interval. Synchronous ref, not the async `status` state, to catch a
    // same-tick double-tap.
    if (busyRef.current) return
    const picked = pickAudioMimeType(isTypeSupported)
    if (picked === null) {
      setErrorKind('unsupported')
      setStatus('error')
      return
    }
    // Discard any prior take before arming a new one — covers a direct start()
    // from the `recorded` state (the normal path goes through reRecord, which
    // already revokes). Prevents an object-URL leak.
    if (takeRef.current !== null) {
      URL.revokeObjectURL(takeRef.current.objectUrl)
      takeRef.current = null
      setTake(null)
    }
    busyRef.current = true
    setErrorKind(null)
    interruptedRef.current = false
    chunksRef.current = []
    setStatus('requesting')

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (error) {
      busyRef.current = false
      setErrorKind(classifyArmError(error))
      setStatus('error')
      return
    }

    // Unmounted during the permission prompt — release the mic immediately (it
    // must never stay live) and touch no state on the dead component.
    if (!mountedRef.current) {
      stream.getTracks().forEach((track) => track.stop())
      busyRef.current = false
      return
    }

    streamRef.current = stream
    pickedRef.current = picked
    // A track ending mid-take = the mic was seized (AC11).
    stream.getAudioTracks().forEach((track) => {
      track.addEventListener('ended', handleInterruption)
    })

    let recorder: MediaRecorder
    try {
      recorder = new MediaRecorder(stream, {
        mimeType: picked.recorderMimeType,
        audioBitsPerSecond,
      })
    } catch (error) {
      releaseStream()
      busyRef.current = false
      setErrorKind(classifyArmError(error))
      setStatus('error')
      return
    }
    recorderRef.current = recorder

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data)
    }
    recorder.onerror = () => handleInterruption()
    recorder.onstop = () => {
      clearElapsed()
      stopMeter()
      releaseStream()
      busyRef.current = false
      const currentPicked = pickedRef.current
      // A zero-chunk stop (immediate stop / a codec that emitted nothing) yields no
      // usable audio — route it to the record-ready panel like an interruption
      // rather than presigning a 0-byte object the AC18 duration gate could miss.
      if (interruptedRef.current || currentPicked === null || chunksRef.current.length === 0) {
        chunksRef.current = []
        setErrorKind('interrupted')
        setStatus('error')
        return
      }
      const blob = new Blob(chunksRef.current, { type: currentPicked.recorderMimeType })
      chunksRef.current = []
      const objectUrl = URL.createObjectURL(blob)
      const durationSec = Math.max(0, Math.round((now() - startMsRef.current) / 1000))
      const nextTake: RecordedTake = {
        blob,
        objectUrl,
        durationSec,
        contentType: currentPicked.canonical,
        ext: currentPicked.ext,
      }
      takeRef.current = nextTake
      setTake(nextTake)
      setStatus('recorded')
    }

    startMsRef.current = now()
    setElapsedSec(0)
    recorder.start()
    setStatus('recording')
    startMeter(stream)

    intervalRef.current = setInterval(() => {
      const seconds = Math.floor((now() - startMsRef.current) / 1000)
      setElapsedSec(seconds)
      if (seconds >= maxDurationSec) {
        stop() // max-duration auto-stop (AC7) — the 25 MB ceiling is never hit
      }
    }, 1000)
  }, [
    isTypeSupported,
    audioBitsPerSecond,
    now,
    maxDurationSec,
    handleInterruption,
    releaseStream,
    clearElapsed,
    stopMeter,
    startMeter,
    stop,
  ])

  const reRecord = useCallback(() => {
    // Defensive: today this is only wired from the preview/interrupted (post-stop)
    // panels, so the recorder is already inactive. But if a future caller invokes it
    // while capture is live, tear the hardware down FIRST — the mic must never stay
    // lit and the timer/meter must not leak (the invariant every other path holds).
    const recorder = recorderRef.current
    if (recorder !== null && recorder.state !== 'inactive') {
      interruptedRef.current = true // onstop drops the partial instead of settling a take
      recorder.stop()
    }
    clearElapsed()
    stopMeter()
    releaseStream()
    const current = takeRef.current
    if (current !== null) {
      URL.revokeObjectURL(current.objectUrl)
      takeRef.current = null
    }
    busyRef.current = false
    setTake(null)
    setErrorKind(null)
    setElapsedSec(0)
    setStatus('idle')
  }, [clearElapsed, stopMeter, releaseStream])

  // Track mount so start() can abort a getUserMedia that resolves post-unmount.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Cleanup on unmount: revoke the preview URL, stop tracks, cancel timers (AC8/AC2).
  useEffect(() => {
    return () => {
      clearElapsed()
      stopMeter()
      releaseStream()
      const recorder = recorderRef.current
      if (recorder !== null && recorder.state !== 'inactive') {
        interruptedRef.current = true
        recorder.stop()
      }
      if (takeRef.current !== null) {
        URL.revokeObjectURL(takeRef.current.objectUrl)
        takeRef.current = null
      }
    }
  }, [clearElapsed, stopMeter, releaseStream])

  return {
    status,
    elapsedSec,
    level,
    take,
    errorKind,
    isSupported,
    start,
    stop,
    reRecord,
  }
}
