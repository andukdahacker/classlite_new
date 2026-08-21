/**
 * AiGradePanel — Story 6.2b (T4). The s23 AI-suggestion review panel: the
 * "Run AI grading" control + credit-cost confirm gate (FD4), the enqueue+poll
 * lifecycle (via `useAiGradeJob`), the generating / slow / stuck / failure states,
 * and the `AIGradeSuggestion` review surface once a result is available.
 *
 * SEPARATION (FW-7): this feature-local panel owns the JOB + the ephemeral review
 * UI (which proposals are accepted/dismissed, the ready overlay). The DRAFT is owned
 * by the parent workspace — Accept calls back (`onAcceptBand` / `onAcceptComment`),
 * and the workspace merges into its durable draft (bands → `draft.scores`, comments →
 * `DraftComment{ source:'ai' }`, dedup on reopen). Confidence/rationale are dropped
 * at that boundary (UX-DR22).
 *
 * TWO "ready" SIGNALS (FD3): the TRIGGERING teacher watches the creator-private poll
 * (`useAiGradeJob`); a REOPEN / a NON-TRIGGERING co-teacher rehydrates from the
 * class-shared `rehydratedSuggestion` (`view.aiSuggestion`) when idle — NEVER the
 * poll (that job is creator-private → 404 for a non-creator).
 *
 * NO AUTO-ENQUEUE (FD4): the panel is idle on mount/remount until the teacher
 * explicitly confirms; a rehydrated suggestion is shown for review but never re-run.
 */
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  AIGradeSuggestion,
  type AiCommentType,
  type AiCriterionKey,
} from '@/components/domain/AIGradeSuggestion'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { components } from '@/lib/api/client'

import { computeOverallBand, CRITERION_KEYS } from '../lib/computeOverallBand'
import { useAiGradeJob } from '../hooks/useAiGradeJob'

type AIWritingGradeResult = components['schemas']['AIWritingGradeResult']

/** The wire subset the workspace needs to merge an accepted AI comment into the
 * draft (confidence/rationale intentionally absent — dropped at this boundary). */
export interface AcceptedAiComment {
  type: AiCommentType
  criterion: AiCriterionKey
  text: string
  anchorStart: number | null
  anchorEnd: number | null
}

export interface AiGradePanelProps {
  submissionId: string
  /** The class-shared latest COMPLETE suggestion (`view.aiSuggestion`), or null. */
  rehydratedSuggestion: AIWritingGradeResult | null
  /** Whether the teacher has started manual grading — drives the AC12 ready overlay. */
  draftDirty: boolean
  /** Criteria already present in the durable draft (`draft.scores` keys). A band already
   * in the draft renders as "Applied" — never re-offered as a plain Accept — so a reopen
   * (where the panel's own accepted-set is fresh) can't silently clobber a later manual
   * edit of that band (code-review 2026-08-21). */
  appliedBandCriteria: ReadonlySet<AiCriterionKey>
  onAcceptBand: (criterion: AiCriterionKey, band: number) => void
  onAcceptComment: (comment: AcceptedAiComment) => void
}

function commentId(index: number): string {
  return `ai-c-${index}`
}

export function AiGradePanel({
  submissionId,
  rehydratedSuggestion,
  draftDirty,
  appliedBandCriteria,
  onAcceptBand,
  onAcceptComment,
}: AiGradePanelProps) {
  const { t } = useTranslation()
  const aiJob = useAiGradeJob(submissionId)

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [dismissedBands, setDismissedBands] = useState<ReadonlySet<string>>(new Set())
  const [dismissedComments, setDismissedComments] = useState<ReadonlySet<string>>(new Set())
  const [acceptedBands, setAcceptedBands] = useState<ReadonlySet<string>>(new Set())
  const [acceptedComments, setAcceptedComments] = useState<ReadonlySet<string>>(new Set())
  // Comment ids currently open in per-card Edit (reported up from AiCommentCard). Bulk
  // "Accept all praise" must SKIP these so it never merges the stale AI-original text
  // over a teacher's in-progress edit (code-review 2026-08-21).
  const [editingComments, setEditingComments] = useState<ReadonlySet<string>>(new Set())
  const [readyOverlay, setReadyOverlay] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  // The reviewable suggestion: the LIVE completed result when the poll is done, else
  // the class-shared rehydrated one while idle (FD3). Never rehydrate mid-run.
  const liveResult = aiJob.phase === 'ready' ? aiJob.result : null
  const suggestion = liveResult ?? (aiJob.phase === 'idle' ? rehydratedSuggestion : null)
  const hasExistingSuggestion = rehydratedSuggestion !== null || aiJob.phase === 'ready'

  // Fire the AC12 ready overlay on the rising phase edge WITHOUT an effect: the
  // React-sanctioned "adjust state while rendering" pattern (a guarded setState +
  // a tracking state) — cheaper than an effect and avoids the set-state-in-effect
  // cascade. A completion while the draft is dirty collapses the panel behind a
  // non-blocking overlay so in-progress work is never clobbered.
  const [prevPhase, setPrevPhase] = useState(aiJob.phase)
  if (prevPhase !== aiJob.phase) {
    setPrevPhase(aiJob.phase)
    if (aiJob.phase === 'ready' && draftDirty) {
      setReadyOverlay(true)
      setCollapsed(true)
    }
  }

  // The AC13/14 refund toasts are genuine side effects (an external system) → an
  // effect that fires ONCE per failed episode. A `useRef` latch (not the dep array)
  // gates it: `t` must stay in deps for lint, but a language switch would otherwise
  // re-satisfy the deps and re-fire a stale toast — the latch makes that a no-op, and
  // resets when the phase leaves `failed` (code-review 2026-08-21).
  // `invalid_band_scores` shows the inline empty-form message (AC13); `poll_error` is
  // an infra failure — inline "couldn't check progress", NO "credit returned" toast.
  const failedToastedRef = useRef(false)
  useEffect(() => {
    if (aiJob.phase !== 'failed') {
      failedToastedRef.current = false
      return
    }
    if (failedToastedRef.current) return
    failedToastedRef.current = true
    if (aiJob.errorKind === 'invalid_ai_response') {
      toast.error(t('grading.ai.toast.invalidOutput'))
    } else if (aiJob.errorKind !== 'invalid_band_scores' && aiJob.errorKind !== 'poll_error') {
      toast.error(t('grading.ai.toast.failed'))
    }
  }, [aiJob.phase, aiJob.errorKind, t])

  // Surface a terminal enqueue error (403/404/409/429 — Dev Notes contract). Same
  // once-per-episode latch so a language switch doesn't re-fire it.
  const enqueueToastedRef = useRef(false)
  useEffect(() => {
    if (!aiJob.enqueueError) {
      enqueueToastedRef.current = false
      return
    }
    if (enqueueToastedRef.current) return
    enqueueToastedRef.current = true
    toast.error(t('grading.ai.toast.enqueueFailed'))
  }, [aiJob.enqueueError, t])

  const confirmRun = () => {
    setConfirmOpen(false)
    setDismissedBands(new Set())
    setDismissedComments(new Set())
    setAcceptedBands(new Set())
    setAcceptedComments(new Set())
    setEditingComments(new Set())
    setReadyOverlay(false)
    setCollapsed(false)
    aiJob.enqueue()
  }

  const handleCommentEditingChange = (id: string, editing: boolean) =>
    setEditingComments((prev) => {
      const next = new Set(prev)
      if (editing) next.add(id)
      else next.delete(id)
      return next
    })

  const acceptBand = (criterion: AiCriterionKey, band: number) => {
    onAcceptBand(criterion, band)
    setAcceptedBands((prev) => new Set(prev).add(criterion))
  }
  const dismissBand = (criterion: AiCriterionKey) =>
    setDismissedBands((prev) => new Set(prev).add(criterion))

  const acceptComment = (
    id: string,
    next: { type: AiCommentType; criterion: AiCriterionKey; text: string },
  ) => {
    const index = Number(id.replace('ai-c-', ''))
    const source = suggestion?.comments[index]
    if (!source) return
    // Normalize a half-anchor (exactly one of start/end null) to a whole-essay general
    // comment: forward BOTH offsets only when BOTH are present, else (null, null) — a
    // stray lone offset must never reach the draft/wire (code-review 2026-08-21).
    const bothAnchored = source.anchorStart !== null && source.anchorEnd !== null
    onAcceptComment({
      type: next.type,
      criterion: next.criterion,
      text: next.text,
      anchorStart: bothAnchored ? source.anchorStart : null,
      anchorEnd: bothAnchored ? source.anchorEnd : null,
    })
    setAcceptedComments((prev) => new Set(prev).add(id))
  }
  const dismissComment = (id: string) =>
    setDismissedComments((prev) => new Set(prev).add(id))

  const acceptAllPraise = () => {
    if (!suggestion) return
    const nowAccepted = new Set(acceptedComments)
    suggestion.comments.forEach((comment, index) => {
      const id = commentId(index)
      // Skip a card the teacher is mid-edit on — its buffer is private to the card, so
      // bulk-accepting here would merge the stale AI-original text and lose the edit
      // (code-review 2026-08-21). It stays for the teacher's explicit per-card Accept.
      if (
        comment.type === 'praise' &&
        !acceptedComments.has(id) &&
        !dismissedComments.has(id) &&
        !editingComments.has(id)
      ) {
        const bothAnchored = comment.anchorStart !== null && comment.anchorEnd !== null
        onAcceptComment({
          type: comment.type,
          criterion: comment.criterion,
          text: comment.text,
          anchorStart: bothAnchored ? comment.anchorStart : null,
          anchorEnd: bothAnchored ? comment.anchorEnd : null,
        })
        nowAccepted.add(id)
      }
    })
    setAcceptedComments(nowAccepted)
  }

  const bandProposals = suggestion
    ? CRITERION_KEYS.map((key) => ({
        criterion: key,
        band: suggestion.criteria[key].band,
        rationale: suggestion.criteria[key].rationale,
        confidence: suggestion.criteria[key].confidence,
        // "Applied" if accepted THIS session OR already present in the durable draft —
        // the latter guards a reopen from re-offering (and clobbering) an edited band.
        accepted: acceptedBands.has(key) || appliedBandCriteria.has(key),
      })).filter((proposal) => !dismissedBands.has(proposal.criterion))
    : []

  const commentProposals = suggestion
    ? suggestion.comments
        .map((comment, index) => {
          const id = commentId(index)
          return {
            id,
            type: comment.type,
            criterion: comment.criterion as AiCriterionKey,
            text: comment.text,
            confidence: comment.confidence,
            anchored: comment.anchorStart !== null && comment.anchorEnd !== null,
            accepted: acceptedComments.has(id),
          }
        })
        .filter((proposal) => !dismissedComments.has(proposal.id))
    : []

  const overallBand = suggestion
    ? computeOverallBand({
        taskResponse: suggestion.criteria.taskResponse.band,
        coherenceCohesion: suggestion.criteria.coherenceCohesion.band,
        lexicalResource: suggestion.criteria.lexicalResource.band,
        grammaticalRange: suggestion.criteria.grammaticalRange.band,
      })
    : 0

  const runDisabled = aiJob.phase === 'generating' || aiJob.isEnqueuing

  return (
    <section
      data-testid="ai-grade-panel"
      aria-label={t('grading.ai.panel.title')}
      className="flex flex-col gap-3 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card p-4 shadow-sm"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">{t('grading.ai.panel.title')}</h2>
        <Button
          type="button"
          size="sm"
          data-testid="ai-run-grading"
          disabled={runDisabled}
          onClick={() => setConfirmOpen(true)}
        >
          {hasExistingSuggestion ? t('grading.ai.rerun') : t('grading.ai.run')}
        </Button>
      </div>

      {aiJob.phase === 'generating' ? <GeneratingState slowLevel={aiJob.slowLevel} /> : null}
      {aiJob.phase === 'stuck' ? <StuckState onRetry={() => setConfirmOpen(true)} /> : null}
      {aiJob.phase === 'failed' ? (
        <FailedState errorKind={aiJob.errorKind} onRetry={() => setConfirmOpen(true)} />
      ) : null}

      {readyOverlay ? (
        <ReadyOverlay
          onReview={() => {
            setReadyOverlay(false)
            setCollapsed(false)
          }}
        />
      ) : null}

      {suggestion && !collapsed ? (
        <AIGradeSuggestion
          bands={bandProposals}
          comments={commentProposals}
          overallBand={overallBand}
          analyzedWordCount={suggestion.analyzedWordCount}
          latencyMs={suggestion.latencyMs}
          onAcceptBand={acceptBand}
          onDismissBand={dismissBand}
          onAcceptComment={acceptComment}
          onDismissComment={dismissComment}
          onAcceptAllPraise={acceptAllPraise}
          onCommentEditingChange={handleCommentEditingChange}
        />
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

// --- states ---

function GeneratingState({ slowLevel }: { slowLevel: 0 | 1 | 2 }) {
  const { t } = useTranslation()
  const slowMessage =
    slowLevel >= 2
      ? t('grading.ai.slow.verySlow')
      : slowLevel >= 1
        ? t('grading.ai.slow.slower')
        : t('grading.ai.generating.body')
  return (
    <div data-testid="ai-grade-generating" className="flex flex-col gap-3" aria-busy="true">
      <p className="text-sm font-medium text-foreground">{t('grading.ai.generating.title')}</p>
      {/* Skeleton mirrors the band-strip + comment layout (AC15 — no centered spinner). */}
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-16 w-full" />
      <p
        data-testid="ai-grade-slow-message"
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
    <div data-testid="ai-grade-stuck" role="status" className="flex flex-col gap-2">
      <p className="text-sm font-medium text-foreground">{t('grading.ai.stuck.title')}</p>
      <p className="text-xs text-muted-foreground">{t('grading.ai.stuck.body')}</p>
      <div>
        <Button type="button" size="xs" variant="outline" data-testid="ai-grade-retry" onClick={onRetry}>
          {t('grading.ai.retry')}
        </Button>
      </div>
    </div>
  )
}

function FailedState({
  errorKind,
  onRetry,
}: {
  errorKind: ReturnType<typeof useAiGradeJob>['errorKind']
  onRetry: () => void
}) {
  const { t } = useTranslation()
  // invalid_band_scores → the "grade manually" empty-form message (all fields stay
  // empty — the panel never pre-fills from a failed job, AC13). poll_error → the
  // infra "couldn't check progress" retry (no refund claim). Any genuine terminal job
  // failure → the neutral "couldn't complete" inline (the "credit returned" detail
  // lives in the toast, not doubled here).
  const message =
    errorKind === 'invalid_band_scores'
      ? t('grading.ai.invalidScores')
      : errorKind === 'poll_error'
        ? t('grading.ai.pollError')
        : t('grading.ai.failed')
  return (
    <div data-testid="ai-grade-failed" role="alert" className="flex flex-col gap-2">
      <p className="text-sm text-foreground">{message}</p>
      <div>
        {/* Inline retry (AC15 — not a full-page error). */}
        <Button type="button" size="xs" data-testid="ai-grade-retry" onClick={onRetry}>
          {t('grading.ai.retry')}
        </Button>
      </div>
    </div>
  )
}

function ReadyOverlay({ onReview }: { onReview: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="ai-grade-ready-overlay"
      // Non-blocking (AC12): an aria-live banner, NOT a modal — it never steals focus
      // or clobbers in-progress work; the teacher opts in via Review.
      role="status"
      aria-live="polite"
      className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--cl-line-soft)] bg-muted/50 px-3 py-2"
    >
      <span className="text-sm text-foreground">{t('grading.ai.ready.overlay')}</span>
      <Button type="button" size="xs" data-testid="ai-grade-review" onClick={onReview}>
        {t('grading.ai.ready.review')}
      </Button>
    </div>
  )
}

// --- confirm dialog (FD4 — credit-cost gate on every enqueue) ---

function AiGradeConfirmDialog({
  open,
  onOpenChange,
  isRerun,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  isRerun: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="ai-grade-confirm-dialog">
        <DialogHeader>
          <DialogTitle>{t('grading.ai.confirm.title')}</DialogTitle>
          <DialogDescription data-testid="ai-grade-confirm-cost">
            {t('grading.ai.confirm.cost')}
          </DialogDescription>
        </DialogHeader>
        {isRerun ? (
          <p data-testid="ai-grade-confirm-rerun-warning" className="text-sm text-[color:var(--cl-amber)]">
            {t('grading.ai.confirm.rerunWarning')}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.ai.confirm.cancel')}
          </Button>
          <Button data-testid="ai-grade-confirm-run" disabled={pending} onClick={onConfirm}>
            {t('grading.ai.confirm.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
