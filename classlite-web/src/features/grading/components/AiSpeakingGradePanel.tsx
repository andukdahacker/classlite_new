/**
 * AiSpeakingGradePanel — Story 6.3c (T4). The s24 AI-suggestion control surface for
 * SPEAKING grading: the "Run AI grading" control + −1-credit confirm gate (SD4), the
 * generating / slow / stuck / failure states, the four-criterion band strip
 * (`AiSpeakingBandStrip`), the collapsible transcript panel with the partial_success
 * value-first header (SD7), and the failure toasts (SD8).
 *
 * SEPARATION (FW-7 / SD5): unlike the shipped 6.2b Writing panel (which owns the whole
 * suggestion surface), the Speaking review is INTERLEAVED — the AI MOMENT cards render in
 * the page's `NotesRail`, not here. So the PAGE mounts `useAiGradeSpeakingJob` and owns
 * the review state (accepted/dismissed/editing, the moment interleave, the draft merge,
 * the two-signal rehydrate); this panel is presentational — it receives the `aiJob`
 * lifecycle + the resolved reviewable `suggestion` + band proposals + callbacks, and owns
 * only its own ephemeral UI (confirm dialog open, transcript collapsed, ready overlay,
 * once-per-episode toast latches).
 *
 * NO AUTO-ENQUEUE (SD4): idle on mount/remount until the teacher explicitly confirms; a
 * rehydrated suggestion is shown for review but never re-run.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AiSpeakingBandStrip,
  type AiSpeakingBandProposal,
  type AiSpeakingCriterionKey,
} from '@/components/domain/AISpeakingGradeSuggestion'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import type { components } from '@/lib/api/client'

import { AiGradeConfirmDialog } from './AiGradePanel'
import type { UseAiGradeSpeakingJobResult } from '../hooks/useAiGradeSpeakingJob'

type AISpeakingGradeResult = components['schemas']['AISpeakingGradeResult']

const MS_PER_SECOND = 1000

/** mm:ss from ms (TS-6 — numbers until this formatter, no Date). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / MS_PER_SECOND))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

export interface AiSpeakingGradePanelProps {
  aiJob: UseAiGradeSpeakingJobResult
  /** The resolved reviewable suggestion (live poll result when ready, else the
   * class-shared `view.aiSpeakingSuggestion` while idle) — the page resolves it (SD3). */
  suggestion: AISpeakingGradeResult | null
  /** True when a completed suggestion already exists (re-run gate copy + warning). */
  hasExistingSuggestion: boolean
  /** AC15 ready-overlay gate, owned by the PAGE (single source of truth) so it withholds
   * the band strip here AND the interleaved moment cards + waveform pins in tandem. When
   * true, this panel hides the suggestion body and shows the non-blocking Review overlay. */
  reviewPending: boolean
  /** Reveal the pending suggestion (the page clears its gate → band strip + moments + pins
   * appear together). */
  onReview: () => void
  /** The four band proposals (accepted derived from `draft.scores`, dismissed filtered). */
  bands: readonly AiSpeakingBandProposal[]
  /** The AI overall-band preview (page computes via computeSpeakingOverallBand). */
  overallBand: number
  /** True when at least one un-accepted praise moment remains (shows "Accept all praise"). */
  hasUnacceptedPraise: boolean
  /** Reset the page's review sets + `aiJob.enqueue()` — the confirmed run (SD4). */
  onConfirmRun: () => void
  onAcceptBand: (criterion: AiSpeakingCriterionKey, band: number) => void
  onDismissBand: (criterion: AiSpeakingCriterionKey) => void
  onAcceptAllPraise: () => void
}

export function AiSpeakingGradePanel({
  aiJob,
  suggestion,
  hasExistingSuggestion,
  reviewPending,
  onReview,
  bands,
  overallBand,
  hasUnacceptedPraise,
  onConfirmRun,
  onAcceptBand,
  onDismissBand,
  onAcceptAllPraise,
}: AiSpeakingGradePanelProps) {
  const { t } = useTranslation()

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [transcriptOpen, setTranscriptOpen] = useState(false)

  // The AC15 ready-overlay gate is owned by the PAGE (`reviewPending`) so it withholds the
  // band strip here AND the interleaved moment cards + waveform pins in tandem (review-fix
  // 2026-08-25). When pending, hide the suggestion body and show the non-blocking overlay.
  const showSuggestion = suggestion !== null && !reviewPending

  // The terminal refund toasts are genuine side effects → an effect that fires ONCE per
  // failed episode. A `useRef` latch (not the dep array) gates it so a language switch does
  // not re-fire a stale toast (6.2b patch). Only the two story-defined refund cases toast:
  // audio_unavailable (SD8/AC16) and invalid_ai_response (AC17). invalid_band_scores shows
  // the inline empty-form message; poll_error is infra (inline retry); any other terminal
  // (stuck_timeout / max_retries_exhausted / generation_failed) shows the inline "grade
  // manually" failed message — none of these toast (no wrong-copy / undefined-key toast).
  const failedToastedRef = useRef(false)
  useEffect(() => {
    if (aiJob.phase !== 'failed') {
      failedToastedRef.current = false
      return
    }
    if (failedToastedRef.current) return
    failedToastedRef.current = true
    if (aiJob.errorKind === 'audio_unavailable') {
      toast.error(t('speakingGrading.ai.toast.audioUnavailable'))
    } else if (aiJob.errorKind === 'invalid_ai_response') {
      toast.error(t('speakingGrading.ai.toast.invalidOutput'))
    }
  }, [aiJob.phase, aiJob.errorKind, t])

  // Enqueue-time rejections (Dev Notes contract). SUBMISSION_TOO_LONG / NOT_GRADABLE are
  // rejected BEFORE the credit deduct (AC4) → inline explanation, NO refund toast; any
  // other enqueue error → the generic "couldn't start" toast. Once-per-episode latch.
  const enqueueToastedRef = useRef(false)
  const enqueueCode = aiJob.enqueueError?.code ?? null
  const isInlineEnqueueReject =
    enqueueCode === 'SUBMISSION_TOO_LONG' || enqueueCode === 'SUBMISSION_NOT_GRADABLE'
  useEffect(() => {
    if (!aiJob.enqueueError) {
      enqueueToastedRef.current = false
      return
    }
    if (enqueueToastedRef.current) return
    enqueueToastedRef.current = true
    // Inline enqueue rejections (no credit spent) never toast — they render inline below.
    if (aiJob.enqueueError.code === 'SUBMISSION_TOO_LONG' || aiJob.enqueueError.code === 'SUBMISSION_NOT_GRADABLE') {
      return
    }
    toast.error(t('speakingGrading.ai.toast.enqueueFailed'))
  }, [aiJob.enqueueError, t])

  const confirmRun = () => {
    setConfirmOpen(false)
    setTranscriptOpen(false)
    // The page's onConfirmRun clears its own `reviewPending` gate for the new run.
    onConfirmRun()
  }

  const runDisabled = aiJob.phase === 'generating' || aiJob.isEnqueuing

  return (
    <section
      data-testid="ai-speaking-grade-panel"
      aria-label={t('speakingGrading.ai.panel.title')}
      className="flex flex-col gap-3 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('speakingGrading.ai.panel.title')}</h2>
        <div className="flex items-center gap-2">
          {showSuggestion && hasUnacceptedPraise ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              data-testid="ai-speaking-accept-all-praise"
              onClick={onAcceptAllPraise}
            >
              {t('speakingGrading.ai.acceptAllPraise')}
            </Button>
          ) : null}
          <Button
            type="button"
            size="sm"
            data-testid="ai-speaking-run"
            disabled={runDisabled}
            onClick={() => setConfirmOpen(true)}
          >
            {hasExistingSuggestion ? t('speakingGrading.ai.rerun') : t('speakingGrading.ai.run')}
          </Button>
        </div>
      </div>

      {aiJob.phase === 'generating' ? <GeneratingState slowLevel={aiJob.slowLevel} /> : null}
      {aiJob.phase === 'stuck' ? <StuckState onRetry={() => setConfirmOpen(true)} /> : null}
      {aiJob.phase === 'failed' ? (
        <FailedState errorKind={aiJob.errorKind} onRetry={() => setConfirmOpen(true)} />
      ) : null}

      {isInlineEnqueueReject ? (
        <p data-testid="ai-speaking-enqueue-reject" role="alert" className="text-sm text-foreground">
          {enqueueCode === 'SUBMISSION_TOO_LONG'
            ? t('speakingGrading.ai.tooLong')
            : t('speakingGrading.ai.notGradable')}
        </p>
      ) : null}

      {reviewPending ? <ReadyOverlay onReview={onReview} /> : null}

      {showSuggestion && suggestion ? (
        <>
          <AiSpeakingBandStrip
            bands={bands}
            overallBand={overallBand}
            analyzedDurationMs={suggestion.analyzedDurationMs}
            latencyMs={suggestion.latencyMs}
            onAcceptBand={onAcceptBand}
            onDismissBand={onDismissBand}
          />
          <TranscriptPanel
            transcript={suggestion.transcript}
            transcriptionStatus={suggestion.transcriptionStatus}
            analyzedDurationMs={suggestion.analyzedDurationMs}
            latencyMs={suggestion.latencyMs}
            open={transcriptOpen}
            onToggle={() => setTranscriptOpen((v) => !v)}
          />
        </>
      ) : null}

      <AiGradeConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        isRerun={hasExistingSuggestion}
        pending={aiJob.isEnqueuing}
        onConfirm={confirmRun}
      />
    </section>
  )
}

// --- transcript panel (SD7 — collapsible; partial_success is value-first) ---

function TranscriptPanel({
  transcript,
  transcriptionStatus,
  analyzedDurationMs,
  latencyMs,
  open,
  onToggle,
}: {
  transcript: string | null
  transcriptionStatus: AISpeakingGradeResult['transcriptionStatus']
  analyzedDurationMs: number
  latencyMs: number
  open: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation()

  // partial_success (SD7/AC11): a `complete` job whose transcript is unavailable is a
  // SUCCESS — lead with the VALUE ("band proposals below"), never a transcript apology,
  // and never imply a refund. The bands + moments render regardless (owned above/in rail).
  if (transcriptionStatus === 'unavailable') {
    return (
      <p
        data-testid="ai-speaking-transcript-unavailable"
        role="status"
        className="text-xs font-medium text-foreground"
      >
        {t('speakingGrading.ai.transcript.unavailable')}
      </p>
    )
  }

  const seconds = Math.round(latencyMs / MS_PER_SECOND)

  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          type="button"
          size="xs"
          variant="outline"
          data-testid="ai-speaking-transcript-toggle"
          aria-expanded={open}
          onClick={onToggle}
        >
          {open ? t('speakingGrading.ai.transcript.hide') : t('speakingGrading.ai.transcript.view')}
        </Button>
      </div>
      {open ? (
        <div className="flex flex-col gap-1 rounded-lg border border-border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground" data-testid="ai-speaking-transcript-meta">
            {t('speakingGrading.ai.transcriptionMeta', {
              duration: formatMs(analyzedDurationMs),
              seconds,
            })}
          </p>
          <p data-testid="ai-speaking-transcript-body" className="whitespace-pre-wrap text-sm text-foreground">
            {transcript ?? ''}
          </p>
        </div>
      ) : null}
    </div>
  )
}

// --- states ---

function GeneratingState({ slowLevel }: { slowLevel: 0 | 1 | 2 }) {
  const { t } = useTranslation()
  const slowMessage =
    slowLevel >= 2
      ? t('speakingGrading.ai.slow.verySlow')
      : slowLevel >= 1
        ? t('speakingGrading.ai.slow.slower')
        : t('speakingGrading.ai.generating.body')
  return (
    <div data-testid="ai-speaking-generating" className="flex flex-col gap-3" aria-busy="true">
      <p className="text-sm font-medium text-foreground">{t('speakingGrading.ai.generating.title')}</p>
      {/* Skeleton mirrors the band-strip layout (AC18 — no centered spinner). */}
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-full" />
      <p
        data-testid="ai-speaking-slow-message"
        role="status"
        aria-live="polite"
        className="text-xs text-muted-foreground"
      >
        {slowMessage}
      </p>
    </div>
  )
}

function StuckState({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div data-testid="ai-speaking-stuck" role="status" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t('speakingGrading.ai.stuck.title')}</p>
      <p className="text-xs text-muted-foreground">{t('speakingGrading.ai.stuck.body')}</p>
      <div>
        <Button type="button" size="xs" variant="outline" data-testid="ai-speaking-retry" onClick={onRetry}>
          {t('speakingGrading.ai.retry')}
        </Button>
      </div>
    </div>
  )
}

function FailedState({
  errorKind,
  onRetry,
}: {
  errorKind: UseAiGradeSpeakingJobResult['errorKind']
  onRetry: () => void
}) {
  const { t } = useTranslation()
  // invalid_band_scores → the "grade manually" empty-form message (the panel never
  // pre-fills bad data, AC17). audio_unavailable → "ask student to re-record" (AC16).
  // poll_error → the infra "couldn't check progress" retry (no refund claim, AC17). Any
  // other terminal → the neutral "couldn't complete" inline.
  const message =
    errorKind === 'invalid_band_scores'
      ? t('speakingGrading.ai.invalidScores')
      : errorKind === 'audio_unavailable'
        ? t('speakingGrading.state.reRecord')
        : errorKind === 'poll_error'
          ? t('speakingGrading.ai.pollError')
          : t('speakingGrading.ai.failed')
  return (
    <div data-testid="ai-speaking-failed" role="alert" className="flex flex-col gap-2">
      <p className="text-sm text-foreground">{message}</p>
      <div>
        <Button type="button" size="xs" data-testid="ai-speaking-retry" onClick={onRetry}>
          {t('speakingGrading.ai.retry')}
        </Button>
      </div>
    </div>
  )
}

function ReadyOverlay({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="ai-speaking-ready-overlay"
      // Non-blocking (AC15): an aria-live banner, NOT a modal — it never steals focus or
      // clobbers in-progress work; the teacher opts in via Review.
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--cl-line-soft)] bg-muted/50 px-3 py-2"
    >
      <span className="text-sm text-foreground">{t('speakingGrading.ai.ready.overlay')}</span>
      <Button type="button" size="xs" data-testid="ai-speaking-review" onClick={onReview}>
        {t('speakingGrading.ai.ready.review')}
      </Button>
    </div>
  )
}
