/**
 * SpeakingRecorderLeaf — Story 5.4 Task 6 (AC2,7,8,9,10,11,24, D6). The ISOLATED
 * recorder leaf: it OWNS `useMediaRecorder`, so its highest-frequency state (the
 * rAF level meter + the 1s elapsed timer) re-renders ONLY this subtree, never the
 * shell (AC2 — the shell subscribes to none of it; it receives the settled take via
 * the stable `onTakeChange` callback). Renders the full recorder state machine:
 * prep → record → recording (elapsed + meter + stop) → preview / re-record, plus
 * the permission-denied (AC10) and mid-recording interruption (AC11) panels.
 *
 * Screen-reader recording path (Sally S3): announces "Recording started" and
 * "Recording stopped — N seconds" ONCE each via a polite live region; the live
 * elapsed is queryable on the Stop button's `aria-label` ("Stop recording, 0:42")
 * — never per-second chatter.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { formatRemaining } from '@/features/attempts'
import { useMediaRecorder, type RecordedTake } from '../hooks/useMediaRecorder'
import { CueCardPrompt } from './CueCardPrompt'
import { RecordingButton } from './RecordingButton'
import { PrepCountdown } from './PrepCountdown'
import { RecordingPreview } from './RecordingPreview'
import { MicPermissionPanel } from './MicPermissionPanel'
import { RecordingInterruptedPanel } from './RecordingInterruptedPanel'

export interface SpeakingRecorderLeafProps {
  prompt: string
  /** Read-only attempt (submitted / locked / deadline passed) — recording disabled. */
  disabled: boolean
  /** Report the settled take (or null on re-record) up to the shell. LOW frequency. */
  onTakeChange: (take: RecordedTake | null) => void
  /** Test injectables. */
  prepSeconds?: number
  maxDurationSec?: number
  now?: () => number
  isTypeSupported?: (mimeType: string) => boolean
}

export function SpeakingRecorderLeaf({
  prompt,
  disabled,
  onTakeChange,
  prepSeconds,
  maxDurationSec,
  now,
  isTypeSupported,
}: SpeakingRecorderLeafProps) {
  const { t } = useTranslation()
  const recorder = useMediaRecorder({ maxDurationSec, now, isTypeSupported })
  const [prepDone, setPrepDone] = useState(false)
  const [announce, setAnnounce] = useState('')

  // Report take changes up (stable callback via ref — never re-fires on ticks).
  const onTakeChangeRef = useRef(onTakeChange)
  useEffect(() => {
    onTakeChangeRef.current = onTakeChange
  })
  const { take, status } = recorder
  useEffect(() => {
    onTakeChangeRef.current(take)
  }, [take])

  // SR announces — once on start, once on stop (Sally S3).
  const prevStatusRef = useRef(status)
  useEffect(() => {
    const prev = prevStatusRef.current
    if (status === 'recording' && prev !== 'recording') {
      setAnnounce(t('speaking.record.startedAnnounce'))
    } else if (status === 'recorded' && prev === 'recording' && take) {
      setAnnounce(t('speaking.record.stoppedAnnounce', { seconds: take.durationSec }))
    }
    prevStatusRef.current = status
  }, [status, take, t])

  // A read-only / foreign-submit flip MID-TAKE stops the recorder so the mic is
  // released immediately (privacy — it must never keep capturing behind the
  // overlay / past the deadline). The settled take then flows up via onTakeChange,
  // where the shell strands it (AC19 — no orphan-upload after the flip).
  const stopRecorder = recorder.stop
  useEffect(() => {
    if (disabled && (status === 'recording' || status === 'requesting')) {
      stopRecorder()
    }
  }, [disabled, status, stopRecorder])

  const liveRegion = (
    <span role="status" aria-live="polite" className="sr-only" data-testid="speaking-sr-announce">
      {announce}
    </span>
  )

  if (!recorder.isSupported) {
    return (
      <div className="flex flex-col gap-4">
        <CueCardPrompt prompt={prompt} />
        <MicPermissionPanel kind="unsupported" />
        {liveRegion}
      </div>
    )
  }

  let body: React.ReactNode
  if (status === 'error') {
    if (recorder.errorKind === 'interrupted') {
      // Read-only lock → no "record again" affordance (it would re-arm the mic
      // behind the lock; the disabled-flip effect only stops recording/requesting).
      body = <RecordingInterruptedPanel onRetry={disabled ? undefined : recorder.reRecord} />
    } else {
      body = (
        <MicPermissionPanel
          kind={recorder.errorKind ?? 'unknown'}
          onRetry={disabled ? undefined : () => void recorder.start()}
        />
      )
    }
  } else if (status === 'recorded' && take) {
    body = (
      <RecordingPreview objectUrl={take.objectUrl} onReRecord={recorder.reRecord} disabled={disabled} />
    )
  } else if (status === 'recording' || status === 'requesting') {
    body = (
      <div className="flex flex-col items-center gap-4" data-testid="speaking-recording">
        <p
          className="flex items-center gap-2 font-mono text-sm font-medium text-[color:var(--cl-red)]"
          data-testid="speaking-recording-label"
        >
          <span aria-hidden="true">●</span>
          {t('speaking.record.recording')}
        </p>
        {/* Soft elapsed length indicator (AC7). */}
        <p className="text-2xl tabular-nums text-[color:var(--cl-ink)]" data-testid="speaking-elapsed">
          {formatRemaining(recorder.elapsedSec)}
        </p>
        {/* rAF level meter (AC2) — high-frequency, leaf-local. */}
        <div
          className="h-2 w-40 overflow-hidden rounded-full bg-[color:var(--cl-line-soft)]"
          aria-hidden="true"
          data-testid="speaking-level-meter"
        >
          <div
            className="h-full bg-[color:var(--cl-red)] transition-[width] duration-75"
            style={{ width: `${Math.round(recorder.level * 100)}%` }}
          />
        </div>
        <button
          type="button"
          onClick={recorder.stop}
          disabled={status === 'requesting' || disabled}
          data-testid="speaking-stop-button"
          aria-label={t('speaking.record.stopAria', {
            time: formatRemaining(recorder.elapsedSec),
          })}
          className="flex min-h-12 min-w-12 items-center justify-center rounded-full border-2 border-[color:var(--cl-red)] px-6 text-base font-medium text-[color:var(--cl-red)] hover:bg-[color:var(--cl-tint-red)]"
        >
          {t('speaking.record.stop')}
        </button>
      </div>
    )
  } else if (!prepDone && !disabled) {
    body = <PrepCountdown prepSeconds={prepSeconds} onDone={() => setPrepDone(true)} />
  } else {
    body = (
      <RecordingButton
        onClick={() => void recorder.start()}
        label={t('speaking.record.start')}
        disabled={disabled}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6" data-testid="speaking-recorder-leaf">
      <CueCardPrompt prompt={prompt} />
      <div className="flex flex-col items-center justify-center gap-4 py-4">{body}</div>
      {liveRegion}
    </div>
  )
}
