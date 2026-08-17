/**
 * ResultSpeakingPlayback — Story 5.5a Task 4 (AC10, D8). Hybrid playback of the
 * student's OWN submitted recording in a native `<audio controls>`:
 *   - First paint uses the inline `audioUrl` (minted with the result read) — no
 *     extra RTT on load (P1-4).
 *   - On play-intent, if the inline URL has aged past ~4 min (`audioUrlMintedAt`
 *     vs the 5-min server expiry) it fetches a fresh URL BEFORE the element can
 *     error, showing a "Loading your recording…" affordance (P1-5).
 *   - An `<audio>` error is the last-resort trigger: the first error mints once and
 *     swaps the src; a SECOND error surfaces a RECOVERABLE "tap to try again"
 *     (never a terminal "unavailable") — as does a mint that itself 4xxs (P1-6).
 *
 * jsdom never truly loads media, so the recovery is driven by synthetic
 * `play`/`error` events in the tests (Murat). The mint rides the on-demand
 * `useSubmissionAudioUrl` (same SEC-8 gate ladder). The `<audio>` is labelled and
 * keyboard-reachable via its native controls; mobile invests a full-width, ≥44px
 * touch target (AC12).
 */
import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import type { components } from '@/lib/api/client'
import {
  AUDIO_URL_STALE_MS,
  useSubmissionAudioUrl,
} from '../api/useSubmissionAudioUrl'

type Submission = components['schemas']['Submission']

export interface ResultSpeakingPlaybackProps {
  assignmentId: string
  submission: Submission
  /** The inline first-paint URL minted with the result read (null → mint on intent). */
  audioUrl: string | null
  /** When the inline URL was minted (server clock) — refresh when older than ~4min. */
  audioUrlMintedAt: string
}

export function ResultSpeakingPlayback({
  assignmentId,
  audioUrl,
  audioUrlMintedAt,
}: ResultSpeakingPlaybackProps) {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const audioQuery = useSubmissionAudioUrl(assignmentId, false)

  const [currentUrl, setCurrentUrl] = useState<string | null>(audioUrl)
  const [loading, setLoading] = useState(false)
  const [showRetry, setShowRetry] = useState(audioUrl === null)
  // A 404 from the mint means the recording genuinely does not exist (no audioKey) —
  // a terminal state, distinct from a transient failure that should keep offering retry.
  const [unavailable, setUnavailable] = useState(false)
  // One-shot guard for the ERROR-driven re-sign: a broken src re-signs ONCE, then a
  // further error surfaces the manual retry (never an error→re-sign→error loop). The
  // play-intent path is deliberately NOT gated by this — it re-signs whenever the URL
  // is genuinely stale, so a page left open self-heals on every expiry, not just once.
  const errorRetriedRef = useRef(false)
  const inFlightRef = useRef(false)

  const isStale = useCallback(() => {
    const minted = Date.parse(audioUrlMintedAt)
    if (Number.isNaN(minted)) return true
    // A wall-clock URL-freshness check (not an i18n/render concern) — the presigned
    // URL expires on real time, so Date.now() is the right reference here.
    return Date.now() - minted > AUDIO_URL_STALE_MS
  }, [audioUrlMintedAt])

  const refresh = useCallback(async () => {
    if (inFlightRef.current) return
    inFlightRef.current = true
    setLoading(true)
    setShowRetry(false)
    const result = await audioQuery.refetch()
    inFlightRef.current = false
    setLoading(false)
    if (result.data?.url) {
      // Clear a retry that a mid-flight <audio> error may have surfaced while this
      // mint was in flight — the fresh src works now, so no stuck retry over it.
      setShowRetry(false)
      setCurrentUrl(result.data.url)
    } else if (result.error?.status === 404) {
      setUnavailable(true)
    } else {
      // A transient mint failure is RECOVERABLE — surface the retry.
      setShowRetry(true)
    }
  }, [audioQuery])

  // Play-intent: proactively re-sign a stale URL before the native element errors.
  // Time-gated (not one-shot), so every expiry on a long-open page self-heals.
  const handlePlay = useCallback(() => {
    if (isStale() && !inFlightRef.current) void refresh()
  }, [isStale, refresh])

  // The last-resort trigger: first error → one re-sign; a later error → recoverable retry.
  const handleError = useCallback(() => {
    if (!errorRetriedRef.current && !inFlightRef.current) {
      errorRetriedRef.current = true
      void refresh()
    } else {
      setShowRetry(true)
    }
  }, [refresh])

  const handleRetry = useCallback(() => {
    errorRetriedRef.current = false
    void refresh()
  }, [refresh])

  return (
    <div
      data-testid="result-speaking-playback"
      data-mobile-legible={!isDesktop ? 'true' : undefined}
      className="flex flex-col gap-2"
    >
      {/* A student's own recording has no caption track; the control is labelled
          via aria-label + reachable through the native controls. */}
      <audio
        controls
        controlsList="nodownload"
        src={currentUrl ?? undefined}
        onPlay={handlePlay}
        onError={handleError}
        aria-label={t('submissionReview.audio.label')}
        data-testid="result-speaking-audio"
        data-fullwidth={!isDesktop ? 'true' : undefined}
        data-touch-target={!isDesktop ? 'lg' : undefined}
        className={cn('w-full', !isDesktop && 'min-h-12')}
      />
      {loading ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="result-speaking-loading"
          className="text-sm text-[var(--cl-ink-soft)]"
        >
          {t('submissionReview.audio.loading')}
        </p>
      ) : null}
      {unavailable ? (
        <p
          role="alert"
          data-testid="result-speaking-unavailable"
          className="text-sm text-[var(--cl-muted)]"
        >
          {t('submissionReview.audio.unavailable')}
        </p>
      ) : showRetry ? (
        <button
          type="button"
          onClick={handleRetry}
          data-testid="result-speaking-retry"
          className="self-start text-sm font-medium text-[var(--cl-accent)] underline"
        >
          {t('submissionReview.audio.retry')}
        </button>
      ) : null}
    </div>
  )
}
