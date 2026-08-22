/**
 * AudioWaveformPlayer — Story 6.3a (AC1/AC2/AC3/AC6/AC12/AC14 · D6/D7). A from-scratch
 * Web-Audio waveform player: fetch → AudioContext.decodeAudioData → computePeaks →
 * <canvas>; play/pause via a hidden <audio>; click/drag on the waveform SEEKs (never
 * pins — D7); a dedicated "Pin here" button + `P` key drops a comment at the current
 * playhead time (speed-INDEPENDENT — audio.currentTime, never elapsed × rate); a
 * four-step speed cycle 0.5/1/1.5/2×; a full keyboard model (←/→ ±5s, Shift ±30s, Space,
 * P) with an aria-live time read-out. No npm dependency (Vite-8/Rolldown constraint, D7).
 *
 * URL freshness (AC2/D5/D6 — mirrors ResultSpeakingPlayback's state machine): the inline
 * `audioUrl` first-paints; on a play-intent when the URL has aged past ~4 min it re-signs
 * (via onRefreshUrl) BEFORE the element can error; a mid-session 404/expiry re-signs ONCE
 * (both decode fetch AND `<audio>` playback error), swaps the live src, and only then
 * degrades. A true 404 (after the one re-sign) or a decode throw → "Ask student to
 * re-record"; a transient 5xx/network → inline retry, NEVER "re-record" (no false
 * positives).
 *
 * Timeline pins (AC6/D7): each pinned comment is a marker; adjacent markers on a long
 * recording CLUSTER into an expandable count-badge (no waveform zoom in v1). A marker
 * click seeks + highlights (bidirectional pin↔card via onSeekToPin/activePinId); dragging
 * a marker nudges its timestamp (onNudgePin).
 *
 * The Web-Audio decode + canvas render live in a `useEffect` — a PERMITTED DOM/library
 * integration use (FW-4 forbids `useEffect` for server-state fetching, not for this).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { computePeaks } from './computePeaks'

/** One pinned comment marker on the timeline (positioned by timestampMs). */
export interface WaveformPin {
  id: string
  timestampMs: number
}

export interface AudioWaveformPlayerProps {
  audioUrl: string
  durationMs: number
  pins?: ReadonlyArray<WaveformPin>
  /** The currently-highlighted pin (rail card ↔ marker, AC6). */
  activePinId?: string | null
  /** "Pin here" button + `P` key — drops a comment at the current playhead (ms). */
  onPinAtPlayhead: (timestampMs: number) => void
  /** Clicking a timeline pin marker seeks + notifies (bidirectional pin↔card). */
  onSeekToPin?: (id: string) => void
  /** Dragging a marker nudges its timestamp to a new position (AC6). */
  onNudgePin?: (id: string, timestampMs: number) => void
  /** A token-guarded external seek command (rail card → playhead, AC6). */
  seekToMs?: { ms: number; token: number } | null
  /** Re-sign a stale/expired URL (AC2/D6) — one retry before giving up on a 404. */
  onRefreshUrl?: () => Promise<string>
}

type LoadState = 'decoding' | 'ready' | 'reRecord' | 'transientError'

/** The four-step playback-speed cycle (D7). */
const SPEEDS = [1, 1.5, 2, 0.5] as const
const WAVEFORM_BUCKETS = 240
const SEEK_STEP_SEC = 5
const SEEK_STEP_LARGE_SEC = 30
const HTTP_NOT_FOUND = 404
const WAVEFORM_WIDTH = 640
const WAVEFORM_HEIGHT = 72
/** A presigned URL lives 5 min server-side; re-sign on play-intent once it is this old. */
const AUDIO_URL_STALE_MS = 4 * 60 * 1000
/** Markers within this fraction of the timeline collapse into one cluster badge (D7). */
const CLUSTER_THRESHOLD_FRACTION = 0.02
/** Pointer travel (px) past which a marker press is a drag-nudge, not a click-seek. */
const NUDGE_MOVE_THRESHOLD_PX = 4

/** mm:ss from milliseconds (TS-6 — numbers until this formatter, no Date). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds.toString().padStart(2, '0')}`
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

interface PinCluster {
  key: string
  fraction: number
  pins: WaveformPin[]
}

export function AudioWaveformPlayer({
  audioUrl,
  durationMs,
  pins = [],
  activePinId = null,
  onPinAtPlayhead,
  onSeekToPin,
  onNudgePin,
  seekToMs = null,
  onRefreshUrl,
}: AudioWaveformPlayerProps) {
  const { t } = useTranslation()
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const waveformRef = useRef<HTMLDivElement | null>(null)

  const [activeUrl, setActiveUrl] = useState(audioUrl)
  const [status, setStatus] = useState<LoadState>('decoding')
  const [peaks, setPeaks] = useState<Float32Array | null>(null)
  const [decodedDurationMs, setDecodedDurationMs] = useState<number | null>(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [speedIndex, setSpeedIndex] = useState(0)
  const [currentMs, setCurrentMs] = useState(0)
  const [reloadNonce, setReloadNonce] = useState(0)
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null)

  // URL-freshness bookkeeping (AC2/D6). mintedAt tracks when the LIVE url was signed
  // (stamped in the decode effect, never during render); the retry refs make each
  // recovery ONE-SHOT so a dead url can't loop.
  const mintedAtRef = useRef(0)
  const inFlightRef = useRef(false)
  const decodeRetriedRef = useRef(false)
  const audioErrorRetriedRef = useRef(false)
  // Distinguishes a marker drag-nudge from a click-seek (moved past a px threshold).
  const nudgeRef = useRef<{ id: string; startX: number; moved: boolean } | null>(null)
  const scrubbingRef = useRef(false)

  // The persisted duration (5.4) is authoritative when present; otherwise fall back to
  // the decoded AudioBuffer's real duration so seek + pins never collapse to 0 (P7).
  const totalMs = durationMs > 0 ? durationMs : decodedDurationMs ?? 0
  const durationSec = totalMs / 1000

  const applyFreshUrl = useCallback((fresh: string) => {
    mintedAtRef.current = Date.now()
    // Swap the live playback src imperatively for an immediate effect, and mirror it into
    // state so the decode effect re-runs and the <audio> stays in sync on the next render.
    const audio = audioRef.current
    if (audio) audio.src = fresh
    setActiveUrl(fresh)
  }, [])

  const refreshUrl = useCallback(async (): Promise<boolean> => {
    if (!onRefreshUrl || inFlightRef.current) return false
    inFlightRef.current = true
    try {
      const fresh = await onRefreshUrl()
      applyFreshUrl(fresh)
      return true
    } catch {
      return false
    } finally {
      inFlightRef.current = false
    }
  }, [onRefreshUrl, applyFreshUrl])

  const isStale = useCallback(() => Date.now() - mintedAtRef.current > AUDIO_URL_STALE_MS, [])

  // --- decode pipeline (permitted useEffect — Web-Audio DOM integration, FW-4) ---
  useEffect(() => {
    // A (re)signed url decodes here — stamp its mint time for the staleness check (AC2).
    mintedAtRef.current = Date.now()
    let cancelled = false

    async function decodeFrom(url: string): Promise<void> {
      setStatus('decoding')
      setPeaks(null)
      let response: Response
      try {
        response = await fetch(url)
      } catch {
        if (!cancelled) setStatus('transientError') // network blip → inline retry, NOT re-record (D6)
        return
      }
      if (cancelled) return
      if (response.status === HTTP_NOT_FOUND) {
        if (onRefreshUrl && !decodeRetriedRef.current) {
          decodeRetriedRef.current = true
          const ok = await refreshUrl() // setActiveUrl → this effect re-runs with the fresh url
          if (!ok && !cancelled) setStatus('reRecord')
          return
        }
        if (!cancelled) setStatus('reRecord') // object truly gone (D6)
        return
      }
      if (!response.ok) {
        if (!cancelled) setStatus('transientError') // transient 5xx → inline retry (D6)
        return
      }
      let buffer: ArrayBuffer
      try {
        buffer = await response.arrayBuffer()
      } catch {
        if (!cancelled) setStatus('transientError')
        return
      }
      if (cancelled) return
      const AudioCtx =
        window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!AudioCtx) {
        if (!cancelled) setStatus('transientError')
        return
      }
      // The ctor itself can throw (browser live-context limit under rapid nav) — keep it
      // inside the try so the failure surfaces a state instead of hanging on "decoding" (P3).
      let ctx: AudioContext | undefined
      try {
        ctx = new AudioCtx()
        const decoded = await ctx.decodeAudioData(buffer)
        const channel = decoded.getChannelData(0)
        const computed = computePeaks(channel, WAVEFORM_BUCKETS)
        if (!cancelled) {
          setPeaks(computed)
          setDecodedDurationMs(Math.round(decoded.duration * 1000))
          setStatus('ready')
        }
      } catch {
        if (!cancelled) setStatus('reRecord') // corrupt/undecodable file (D6)
      } finally {
        void ctx?.close?.()
      }
    }

    void decodeFrom(activeUrl)
    return () => {
      cancelled = true
    }
  }, [activeUrl, reloadNonce, onRefreshUrl, refreshUrl])

  // --- canvas render (played bars darker) — DOM imperative, null-guarded for jsdom ---
  useEffect(() => {
    if (status !== 'ready' || !peaks) return
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return // jsdom / SSR — the pure peaks are covered separately (D7)
    const width = canvas.width
    const height = canvas.height
    // Read the played/unplayed bar colors from --cl-* design tokens (no raw hex — the
    // canvas 2D API needs concrete color strings). Falls back to currentColor when a
    // token is unavailable (jsdom / SSR).
    const styles = window.getComputedStyle(canvas)
    const playedColor = styles.getPropertyValue('--cl-ink-soft').trim() || 'currentColor'
    const unplayedColor = styles.getPropertyValue('--cl-line').trim() || 'currentColor'
    ctx.clearRect(0, 0, width, height)
    const barWidth = peaks.length > 0 ? width / peaks.length : width
    const playedFraction = durationSec > 0 ? currentMs / 1000 / durationSec : 0
    for (let i = 0; i < peaks.length; i++) {
      const barHeight = Math.max(1, peaks[i] * height)
      const x = i * barWidth
      const played = i / peaks.length <= playedFraction
      ctx.fillStyle = played ? playedColor : unplayedColor
      ctx.fillRect(x, (height - barHeight) / 2, Math.max(1, barWidth - 1), barHeight)
    }
  }, [status, peaks, currentMs, durationSec])

  const applySpeed = useCallback((index: number) => {
    const audio = audioRef.current
    if (audio) audio.playbackRate = SPEEDS[index]
  }, [])

  // External seek command (rail card → playhead, AC6). Token-guarded so it fires once per
  // request, not on every unrelated re-render.
  const lastSeekTokenRef = useRef(0)
  useEffect(() => {
    if (!seekToMs || seekToMs.token === lastSeekTokenRef.current) return
    lastSeekTokenRef.current = seekToMs.token
    const audio = audioRef.current
    if (!audio) return
    const upper = durationSec > 0 ? durationSec : Math.max(0, seekToMs.ms / 1000)
    const next = clamp(seekToMs.ms / 1000, 0, upper)
    audio.currentTime = next
    setCurrentMs(next * 1000)
  }, [seekToMs, durationSec])

  const seekTo = useCallback(
    (sec: number) => {
      const audio = audioRef.current
      if (!audio) return
      // Upper bound is the known duration; when duration is unknown, floor at 0 so a
      // backward step never produces a negative currentTime (E7).
      const upper = durationSec > 0 ? durationSec : Math.max(0, sec)
      const next = clamp(sec, 0, upper)
      audio.currentTime = next
      setCurrentMs(next * 1000)
    },
    [durationSec],
  )

  const togglePlay = useCallback(() => {
    const audio = audioRef.current
    if (!audio) return
    if (isPlaying) {
      audio.pause()
      setIsPlaying(false)
      return
    }
    // AC2 — proactively re-sign a stale URL before the element can error (non-blocking:
    // the fresh src swaps in imperatively; a still-bad src falls through to onError).
    if (isStale()) void refreshUrl()
    setIsPlaying(true)
    // P2 — never leave the UI stuck on "Pause" if play() rejects (autoplay/expiry/decode).
    audio.play().then(
      () => {},
      () => setIsPlaying(false),
    )
  }, [isPlaying, isStale, refreshUrl])

  const onAudioError = useCallback(() => {
    // Playback-path recovery (AC2/D6): first error re-signs once; a second surfaces the
    // recoverable retry rather than looping.
    if (onRefreshUrl && !audioErrorRetriedRef.current) {
      audioErrorRetriedRef.current = true
      void refreshUrl()
    } else {
      setStatus('transientError')
    }
  }, [onRefreshUrl, refreshUrl])

  const cycleSpeed = useCallback(() => {
    setSpeedIndex((prev) => {
      const next = (prev + 1) % SPEEDS.length
      applySpeed(next)
      return next
    })
  }, [applySpeed])

  const pinAtPlayhead = useCallback(() => {
    const audio = audioRef.current
    // Speed-INDEPENDENT: the pin is real audio time, never elapsed-listening × rate (D7).
    const ms = audio ? Math.round(audio.currentTime * 1000) : currentMs
    onPinAtPlayhead(ms)
  }, [onPinAtPlayhead, currentMs])

  const onTransportKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      // Only the group container's own focus drives the transport keys; a focused child
      // button keeps its native Space/Enter activation (P8 — WCAG operability).
      if (event.target !== event.currentTarget) return
      const audio = audioRef.current
      switch (event.key) {
        case 'ArrowRight': {
          event.preventDefault()
          if (audio) seekTo(audio.currentTime + (event.shiftKey ? SEEK_STEP_LARGE_SEC : SEEK_STEP_SEC))
          break
        }
        case 'ArrowLeft': {
          event.preventDefault()
          if (audio) seekTo(audio.currentTime - (event.shiftKey ? SEEK_STEP_LARGE_SEC : SEEK_STEP_SEC))
          break
        }
        case ' ':
        case 'Spacebar': {
          event.preventDefault()
          togglePlay()
          break
        }
        case 'p':
        case 'P': {
          event.preventDefault()
          pinAtPlayhead()
          break
        }
        default:
          break
      }
    },
    [seekTo, togglePlay, pinAtPlayhead],
  )

  const seekFromClientX = useCallback(
    (clientX: number) => {
      const canvas = canvasRef.current
      if (!canvas) return
      const rect = canvas.getBoundingClientRect()
      if (rect.width <= 0) return
      const fraction = clamp((clientX - rect.left) / rect.width, 0, 1)
      seekTo(fraction * durationSec)
    },
    [seekTo, durationSec],
  )

  // Waveform click/drag = SEEK ONLY (never pins — D7 gesture-collision fix).
  const onCanvasClick = useCallback(
    (event: React.MouseEvent) => seekFromClientX(event.clientX),
    [seekFromClientX],
  )
  const onCanvasPointerDown = useCallback(
    (event: React.PointerEvent) => {
      scrubbingRef.current = true
      event.currentTarget.setPointerCapture?.(event.pointerId)
      seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )
  const onCanvasPointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (scrubbingRef.current) seekFromClientX(event.clientX)
    },
    [seekFromClientX],
  )
  const endScrub = useCallback(() => {
    scrubbingRef.current = false
  }, [])

  const retry = useCallback(() => {
    decodeRetriedRef.current = false
    audioErrorRetriedRef.current = false
    setReloadNonce((n) => n + 1)
  }, [])

  // Cluster adjacent markers so a long recording's pins don't overlap (D7 — no zoom v1).
  const clusters = useMemo<PinCluster[]>(() => {
    if (totalMs <= 0) return []
    const sorted = [...pins].sort((a, b) => a.timestampMs - b.timestampMs)
    const out: PinCluster[] = []
    for (const pin of sorted) {
      const fraction = clamp(pin.timestampMs / totalMs, 0, 1)
      const last = out[out.length - 1]
      if (last && fraction - last.fraction <= CLUSTER_THRESHOLD_FRACTION) {
        last.pins.push(pin)
        last.fraction = last.pins.reduce((s, p) => s + clamp(p.timestampMs / totalMs, 0, 1), 0) / last.pins.length
      } else {
        out.push({ key: pin.id, fraction, pins: [pin] })
      }
    }
    return out
  }, [pins, totalMs])

  const seekToPin = useCallback(
    (pin: WaveformPin) => {
      seekTo(pin.timestampMs / 1000)
      onSeekToPin?.(pin.id)
    },
    [seekTo, onSeekToPin],
  )

  const onMarkerPointerDown = useCallback((event: React.PointerEvent, id: string) => {
    if (!onNudgePin) return
    event.stopPropagation() // don't scrub the canvas underneath
    nudgeRef.current = { id, startX: event.clientX, moved: false }
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [onNudgePin])

  const onMarkerPointerMove = useCallback(
    (event: React.PointerEvent, id: string) => {
      const nudge = nudgeRef.current
      if (!nudge || nudge.id !== id) return
      // Ignore sub-threshold jitter so a plain click isn't misread as a nudge.
      if (Math.abs(event.clientX - nudge.startX) <= NUDGE_MOVE_THRESHOLD_PX) return
      const container = waveformRef.current
      if (!container) return
      const rect = container.getBoundingClientRect()
      if (rect.width <= 0) return
      nudge.moved = true
      const fraction = clamp((event.clientX - rect.left) / rect.width, 0, 1)
      onNudgePin?.(id, Math.round(fraction * totalMs))
    },
    [onNudgePin, totalMs],
  )

  const onMarkerPointerUp = useCallback((_event: React.PointerEvent, id: string) => {
    const nudge = nudgeRef.current
    if (nudge && nudge.id === id) nudgeRef.current = null
  }, [])

  const onMarkerClick = useCallback(
    (pin: WaveformPin) => {
      // A press that moved is a nudge, not a seek — swallow the synthetic click.
      if (nudgeRef.current?.moved) {
        nudgeRef.current = null
        return
      }
      seekToPin(pin)
    },
    [seekToPin],
  )

  if (status === 'reRecord') {
    return (
      <div
        data-testid="waveform-rerecord"
        role="alert"
        className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center"
      >
        <p className="text-sm font-medium text-foreground">{t('speakingGrading.state.reRecord')}</p>
        <p className="text-sm text-muted-foreground">{t('speakingGrading.state.reRecordBody')}</p>
      </div>
    )
  }

  if (status === 'transientError') {
    return (
      <div
        data-testid="waveform-transient-error"
        role="alert"
        className="flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center"
      >
        <p className="text-sm text-muted-foreground">{t('speakingGrading.state.transientBody')}</p>
        <Button size="sm" onClick={retry} data-testid="waveform-retry">
          {t('speakingGrading.state.audioRetry')}
        </Button>
      </div>
    )
  }

  const speedRate = SPEEDS[speedIndex]

  return (
    <div
      data-testid="waveform-transport"
      role="group"
      tabIndex={0}
      aria-label={t('speakingGrading.criteria.title')}
      onKeyDown={onTransportKeyDown}
      className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {/* Playback element (hidden; the canvas is the visual). */}
      <audio
        ref={audioRef}
        src={activeUrl}
        preload="metadata"
        className="sr-only"
        onTimeUpdate={(e) => setCurrentMs(e.currentTarget.currentTime * 1000)}
        onEnded={() => setIsPlaying(false)}
        onError={onAudioError}
      />

      {status === 'decoding' ? (
        <div
          data-testid="waveform-skeleton"
          role="status"
          className="flex h-[72px] items-center justify-center rounded-lg bg-muted/50 text-sm text-muted-foreground"
        >
          {t('speakingGrading.state.preparingAudio')}
        </div>
      ) : (
        <div className="relative" ref={waveformRef}>
          <canvas
            ref={canvasRef}
            width={WAVEFORM_WIDTH}
            height={WAVEFORM_HEIGHT}
            onClick={onCanvasClick}
            onPointerDown={onCanvasPointerDown}
            onPointerMove={onCanvasPointerMove}
            onPointerUp={endScrub}
            onPointerCancel={endScrub}
            aria-label={t('speakingGrading.player.timeReadout', {
              current: formatMs(currentMs),
              total: formatMs(totalMs),
            })}
            className="block h-[72px] w-full cursor-pointer rounded-lg bg-[color:var(--cl-surface-warm)] touch-none"
          />
          {clusters.map((cluster) => {
            if (cluster.pins.length === 1) {
              const pin = cluster.pins[0]
              const active = activePinId === pin.id
              return (
                <button
                  key={pin.id}
                  type="button"
                  data-testid={`waveform-pin-${pin.id}`}
                  aria-label={t('speakingGrading.pin.markerLabel', { time: formatMs(pin.timestampMs) })}
                  aria-current={active ? 'true' : undefined}
                  onClick={() => onMarkerClick(pin)}
                  onPointerDown={(e) => onMarkerPointerDown(e, pin.id)}
                  onPointerMove={(e) => onMarkerPointerMove(e, pin.id)}
                  onPointerUp={(e) => onMarkerPointerUp(e, pin.id)}
                  className={cn(
                    'absolute top-1 h-[calc(100%-0.5rem)] w-[3px] -translate-x-1/2 rounded-full',
                    onNudgePin ? 'cursor-ew-resize' : 'cursor-pointer',
                    active ? 'bg-ring ring-2 ring-ring' : 'bg-primary',
                  )}
                  style={{ left: `${cluster.fraction * 100}%` }}
                />
              )
            }
            const expanded = expandedCluster === cluster.key
            return (
              <div
                key={cluster.key}
                className="absolute top-0 -translate-x-1/2"
                style={{ left: `${cluster.fraction * 100}%` }}
              >
                <button
                  type="button"
                  data-testid={`waveform-cluster-${cluster.key}`}
                  aria-label={t('speakingGrading.pin.cluster', { count: cluster.pins.length })}
                  aria-expanded={expanded}
                  onClick={() => setExpandedCluster((prev) => (prev === cluster.key ? null : cluster.key))}
                  className="flex h-5 min-w-5 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground"
                >
                  {cluster.pins.length}
                </button>
                {expanded ? (
                  <ul
                    data-testid={`waveform-cluster-list-${cluster.key}`}
                    className="absolute left-1/2 top-6 z-10 flex -translate-x-1/2 flex-col gap-1 rounded-lg border border-border bg-popover p-1 shadow-lg"
                  >
                    {cluster.pins.map((pin) => (
                      <li key={pin.id}>
                        <button
                          type="button"
                          data-testid={`waveform-pin-${pin.id}`}
                          aria-current={activePinId === pin.id ? 'true' : undefined}
                          onClick={() => {
                            seekToPin(pin)
                            setExpandedCluster(null)
                          }}
                          className="whitespace-nowrap rounded px-2 py-1 text-left text-xs hover:bg-accent"
                        >
                          {t('speakingGrading.pin.markerLabel', { time: formatMs(pin.timestampMs) })}
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            )
          })}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={togglePlay}
          aria-label={isPlaying ? t('speakingGrading.player.pause') : t('speakingGrading.player.play')}
          data-testid="waveform-play"
        >
          {isPlaying ? t('speakingGrading.player.pause') : t('speakingGrading.player.play')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => audioRef.current && seekTo(audioRef.current.currentTime - SEEK_STEP_SEC)}
          aria-label={t('speakingGrading.player.seekBackward')}
          data-testid="waveform-seek-back"
        >
          −5s
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => audioRef.current && seekTo(audioRef.current.currentTime + SEEK_STEP_SEC)}
          aria-label={t('speakingGrading.player.seekForward')}
          data-testid="waveform-seek-forward"
        >
          +5s
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={cycleSpeed}
          aria-label={t('speakingGrading.player.speedLabel', { rate: speedRate })}
          data-testid="waveform-speed"
        >
          {t('speakingGrading.player.speedLabel', { rate: speedRate })}
        </Button>
        <Button size="sm" onClick={pinAtPlayhead} data-testid="waveform-pin-here">
          {t('speakingGrading.pin.here')}
        </Button>
        <span
          aria-live="polite"
          data-testid="waveform-time-readout"
          className={cn('ml-auto font-mono text-xs text-muted-foreground')}
        >
          {t('speakingGrading.player.timeReadout', {
            current: formatMs(currentMs),
            total: formatMs(totalMs),
          })}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{t('speakingGrading.pin.keyboardHint')}</p>
    </div>
  )
}
