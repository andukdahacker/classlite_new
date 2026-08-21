/**
 * WritingGradingPage — Story 6.1 (AC12-18). The teacher Writing grading surface
 * (screen s23, desktop-only). Wires behavior into the static WritingGradingSurface +
 * CommentCard shells: highlight-and-pin over plain-text UTF-16 offsets, a
 * selection-anchored comment composer, four criterion inputs with a server-mirrored
 * live overall band, a durable private draft (D4), submit/release + revise, and a
 * lossless prev/next grading queue.
 *
 * Mounted with key={submissionId} by the route so a queue nav fully re-seeds the
 * per-submission draft (lossless round-trip, D4).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import {
  WritingGradingSurface,
  type AnchoredComment,
  type CommentType,
} from '@/components/domain/WritingGradingSurface'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { ApiError } from '@/lib/api-fetch'

import { useGradingSubmission, type TeacherGradingView } from './api/useGradingSubmission'
import { useGradeSubmission, type GradeInput } from './api/useGradeSubmission'
import { useReviseGrade } from './api/useReviseGrade'
import { useGradingQueue, type GradingQueueRow } from './api/useGradingQueue'
import { AiGradePanel, type AcceptedAiComment } from './components/AiGradePanel'
import {
  CRITERION_KEYS,
  isValidBand,
  overallBandMath,
  type CriterionScores,
} from './lib/computeOverallBand'
import {
  buildEssayHtml,
  captureSelectionOffsets,
  normalizeAnchor,
  resolveStoredAnchors,
  utf16Slice,
  type EssayAnchor,
} from '@/lib/essayAnchors'
import {
  clearGradingDraft,
  emptyGradingDraft,
  useGradingDraft,
  type DraftComment,
  type DraftCommentType,
  type DraftComposer,
  type GradingDraft,
} from './lib/gradingDraft'

const ESSAY_TESTID = 'writing-grading-surface-essay'

/** Map the wire/draft comment type to the CommentCard taxonomy. */
function toCardType(type: DraftCommentType): CommentType {
  return type === 'suggestion' ? 'suggest' : type
}

function readEssayText(view: TeacherGradingView): string {
  const content = view.submission.content as { text?: unknown }
  return typeof content.text === 'string' ? content.text : ''
}

/** Seed a draft from an already-released grade (revise flow). */
function draftFromGrade(view: TeacherGradingView): () => GradingDraft {
  return () => {
    if (!view.grade) return emptyGradingDraft()
    const scores: Partial<CriterionScores> = { ...view.grade.criterionScores }
    const comments: DraftComment[] = view.grade.comments.map((c, i) => ({
      id: `g-${i}`,
      type: c.type,
      // The server criterion enum is non-null (Decision A) — fall back to the first
      // key only for defensive typing on legacy/empty data.
      criterion: (c.criterion as keyof CriterionScores) ?? CRITERION_KEYS[0],
      anchorStart: c.anchorStart,
      anchorEnd: c.anchorEnd,
      text: c.text,
      source: 'teacher', // seeded from a released grade (Story 6.2b FD2)
    }))
    return { scores, comments, composer: null }
  }
}

export function WritingGradingPage() {
  const { t } = useTranslation()
  const params = useParams()
  const navigate = useNavigate()
  const classId = params.id ?? ''
  const assignmentId = params.aid ?? ''
  const submissionId = params.sid ?? ''

  const isDesktop = useIsDesktop()
  const query = useGradingSubmission(submissionId)
  const queueQuery = useGradingQueue(classId, assignmentId)

  if (!isDesktop) {
    return <DesktopOnlySeam classId={classId} assignmentId={assignmentId} submissionId={submissionId} />
  }

  if (query.isLoading) {
    return <GradingSkeleton />
  }
  if (query.isError) {
    return (
      <GradingError
        message={query.error instanceof ApiError ? query.error.message : t('grading.error.generic')}
        onRetry={() => query.refetch()}
      />
    )
  }
  const view = query.data
  if (!view) {
    return <GradingError message={t('grading.error.generic')} onRetry={() => query.refetch()} />
  }
  // Empty submission (queue slot with no submission / in_progress) OR a submitted
  // submission with no essay text → a "nothing to grade yet" state, never a blank
  // pinnable essay pane (John; chunk-2 review P5).
  if (view.submission.status === 'in_progress' || readEssayText(view).trim() === '') {
    return <NothingToGrade />
  }

  // Re-key on (status, grade version) so a release (submitted→graded) and each revise
  // (version N→N+1) fully remount the workspace — the just-released/revised grade is
  // re-seeded from the refetch instead of leaving the surface blank or showing the
  // stale local draft (chunk-2 review P1/P2).
  return (
    <GradingWorkspace
      key={`${submissionId}:${view.submission.status}:${view.grade?.version ?? 0}`}
      view={view}
      submissionId={submissionId}
      queue={queueQuery.data ?? []}
      queueError={queueQuery.isError}
      onNavigate={(sid) => navigate(`/classes/${classId}/grading/${assignmentId}/${sid}`)}
    />
  )
}

interface WorkspaceProps {
  view: TeacherGradingView
  submissionId: string
  queue: GradingQueueRow[]
  queueError: boolean
  onNavigate: (submissionId: string) => void
}

function GradingWorkspace({
  view,
  submissionId,
  queue,
  queueError,
  onNavigate,
}: WorkspaceProps) {
  const { t } = useTranslation()
  const essayText = useMemo(() => readEssayText(view), [view])
  const alreadyGraded = view.submission.status === 'graded'

  const seed = useMemo(() => draftFromGrade(view), [view])
  const { draft, setDraft: persistDraft } = useGradingDraft(submissionId, alreadyGraded ? seed : undefined)

  // "Touched this session" — flipped by ANY draft mutation through the wrapped setter.
  // `draftDirty` (the AC12 ready-overlay gate) must mean "the teacher started working
  // this session", NOT "the draft has content": a revise/reopen seeded from a released
  // grade has scores+comments but no in-progress work, and would otherwise spuriously
  // hide the first AI result behind the Review? overlay (code-review 2026-08-21).
  const [draftTouched, setDraftTouched] = useState(false)
  const setDraft = useCallback(
    (updater: (prev: GradingDraft) => GradingDraft) => {
      setDraftTouched(true)
      persistDraft(updater)
    },
    [persistDraft],
  )

  const [focusedIndex, setFocusedIndex] = useState<number | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  const surfaceRef = useRef<HTMLDivElement | null>(null)

  const gradeMutation = useGradeSubmission(submissionId)
  const reviseMutation = useReviseGrade(submissionId)

  // a11y: set the page title (own effect so a language change doesn't also re-run the
  // focus effect below and steal focus mid-interaction — chunk-2 review P9).
  useEffect(() => {
    document.title = `${view.student.fullName} — ${t('grading.overall.label')}`
  }, [view.student.fullName, t])

  // Move focus to the heading on MOUNT ONLY (screen-reader route-change announcement).
  // DOM-imperative — a permitted useEffect (FW-4).
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('[data-testid="grading-queue-bar"] h1')
    heading?.focus()
  }, [])

  // Capture a selection over the essay pane on mouse-up into the DURABLE composer
  // (AC15). A composer that is already open is NOT clobbered by a stray mouse-up
  // (chunk-2 review P15) — the ref lets the listener read the latest state without
  // re-subscribing.
  const composerOpenRef = useRef(false)
  useEffect(() => {
    composerOpenRef.current = draft.composer !== null
  })
  useEffect(() => {
    function onMouseUp() {
      if (composerOpenRef.current) return
      const essay = document.querySelector<HTMLElement>(`[data-testid="${ESSAY_TESTID}"]`)
      if (!essay) return
      const offsets = captureSelectionOffsets(essay)
      if (!offsets) return
      const normalized = normalizeAnchor(essayText, offsets.start, offsets.end)
      if (!normalized) return
      const sel = window.getSelection()
      const rect = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).getBoundingClientRect() : null
      setDraft((prev) => ({
        ...prev,
        composer: {
          anchorStart: normalized.start,
          anchorEnd: normalized.end,
          rectTop: rect ? rect.bottom + window.scrollY : window.scrollY + 120,
          rectLeft: rect ? rect.left + window.scrollX : window.scrollX + 24,
          type: 'error',
          criterion: CRITERION_KEYS[0],
          text: '',
        },
      }))
    }
    document.addEventListener('mouseup', onMouseUp)
    return () => document.removeEventListener('mouseup', onMouseUp)
  }, [essayText, setDraft])

  // Resolve stored anchors through the SHARED resolver (normalizeAnchor demotion) — the
  // same single source the student reader uses, so the two buildEssayHtml consumers can
  // never drift on identical offsets (WF-8 cross-side parity; pinned by the shared
  // WRITING_ANCHOR_FIXTURE in grading/lib/__tests__/essayAnchorParity.test.ts).
  const spanAnchors: EssayAnchor[] = useMemo(
    () => resolveStoredAnchors(draft.comments, essayText),
    [draft.comments, essayText],
  )

  const essayHtml = useMemo(() => buildEssayHtml(essayText, spanAnchors), [essayText, spanAnchors])

  const anchoredComments: AnchoredComment[] = useMemo(
    () =>
      draft.comments.map((c, index) => ({
        id: `c-${index}`,
        type: toCardType(c.type),
        criterionKey: `criterion.${c.criterion}`,
        body: c.text,
        anchor: {
          start: c.anchorStart ?? 0,
          end: c.anchorEnd ?? 0,
          text: c.anchorStart !== null && c.anchorEnd !== null ? utf16Slice(essayText, c.anchorStart, c.anchorEnd) : '',
        },
      })),
    [draft.comments, essayText],
  )

  const math = useMemo(() => overallBandMath(draft.scores), [draft.scores])
  const scoreForSurface = useMemo(
    () => ({
      primary: math ? math.band : -1,
      criteria: CRITERION_KEYS.map((key) => ({
        criterionKey: `criterion.${key}`,
        score: draft.scores[key] ?? -1,
      })),
    }),
    [math, draft.scores],
  )

  // --- composer (durable, AC15) ---
  const updateComposer = useCallback(
    (patch: Partial<DraftComposer>) =>
      setDraft((prev) => (prev.composer ? { ...prev, composer: { ...prev.composer, ...patch } } : prev)),
    [setDraft],
  )
  const cancelComposer = useCallback(() => {
    setDraft((prev) => ({ ...prev, composer: null }))
    window.getSelection()?.removeAllRanges()
  }, [setDraft])
  const commitComposer = useCallback(() => {
    setDraft((prev) => {
      const c = prev.composer
      if (!c || c.text.trim() === '') return prev
      return {
        ...prev,
        comments: [
          ...prev.comments,
          {
            id: `d-${prev.comments.length}-${c.text.length}`,
            type: c.type,
            criterion: c.criterion,
            anchorStart: c.anchorStart,
            anchorEnd: c.anchorEnd,
            text: c.text.trim(),
            source: 'teacher', // teacher-authored via the composer (Story 6.2b FD2)
          },
        ],
        composer: null,
      }
    })
    window.getSelection()?.removeAllRanges()
  }, [setDraft])

  const removeComment = useCallback(
    (index: number) => {
      setDraft((prev) => ({ ...prev, comments: prev.comments.filter((_, i) => i !== index) }))
      setFocusedIndex(null) // the announced index is gone / has shifted (chunk-2 review P8)
    },
    [setDraft],
  )

  const setScore = useCallback(
    (key: keyof CriterionScores, value: number) =>
      setDraft((prev) => ({ ...prev, scores: { ...prev.scores, [key]: value } })),
    [setDraft],
  )

  // --- AI suggestion merge into the durable draft (Story 6.2b FD2/FD5) ---
  // Accepting an AI band writes the band NUMBER only into draft.scores (rationale +
  // confidence dropped at this boundary); the overall recomputes via the existing math.
  const acceptAiBand = useCallback(
    (key: keyof CriterionScores, band: number) => setScore(key, band),
    [setScore],
  )
  // Accepting an AI comment appends a DraftComment{ source:'ai' }; confidence/rationale
  // are absent from the payload so they can never reach `grades`. Dedup on reopen
  // (AC9): an identical already-merged AI comment is not appended again.
  const acceptAiComment = useCallback(
    (comment: AcceptedAiComment) =>
      setDraft((prev) => {
        const alreadyMerged = prev.comments.some(
          (existing) =>
            existing.source === 'ai' &&
            existing.criterion === comment.criterion &&
            existing.text === comment.text &&
            existing.anchorStart === comment.anchorStart &&
            existing.anchorEnd === comment.anchorEnd,
        )
        if (alreadyMerged) return prev
        return {
          ...prev,
          comments: [
            ...prev.comments,
            {
              // A collision-free id: the prior `ai-${length}-${textLen}` scheme could
              // repeat after a delete (length is not monotonic), producing a duplicate
              // React key (code-review 2026-08-21).
              id: `ai-${crypto.randomUUID()}`,
              type: comment.type,
              criterion: comment.criterion,
              anchorStart: comment.anchorStart,
              anchorEnd: comment.anchorEnd,
              text: comment.text,
              source: 'ai',
            },
          ],
        }
      }),
    [setDraft],
  )

  // Gates the non-blocking "ready — Review?" overlay so a completed run never clobbers
  // in-progress work (AC12). Dirty = the teacher edited this session OR a composer is
  // open (unsaved work) — a purely seeded revise/reopen draft is NOT dirty.
  const draftDirty = draftTouched || draft.composer !== null

  // Criteria already scored in the durable draft — a band present here renders as
  // "Applied" in the AI panel (never re-offered), so a reopen can't clobber a manual
  // edit of that band (code-review 2026-08-21).
  const appliedBandCriteria = useMemo(
    () => new Set(CRITERION_KEYS.filter((key) => draft.scores[key] !== undefined)),
    [draft.scores],
  )

  const buildGradeInput = useCallback((): GradeInput => {
    return {
      criterionScores: {
        taskResponse: draft.scores.taskResponse ?? 0,
        coherenceCohesion: draft.scores.coherenceCohesion ?? 0,
        lexicalResource: draft.scores.lexicalResource ?? 0,
        grammaticalRange: draft.scores.grammaticalRange ?? 0,
      },
      comments: draft.comments.map((c) => ({
        type: c.type,
        criterion: c.criterion,
        anchorStart: c.anchorStart,
        anchorEnd: c.anchorEnd,
        text: c.text,
      })),
      feedback: null,
    }
  }, [draft])

  const allScored = CRITERION_KEYS.every((k) => typeof draft.scores[k] === 'number')

  const doRelease = useCallback(() => {
    gradeMutation.mutate(buildGradeInput(), {
      onSuccess: () => {
        // Drop the persisted draft; the mutation's refetch flips status→graded, which
        // remounts the workspace (composite key) to re-seed from the released grade —
        // no blank surface (chunk-2 review P1).
        clearGradingDraft(submissionId)
        setConfirmOpen(false)
        toast.success(t('grading.release.success'))
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t('grading.error.generic')),
    })
  }, [gradeMutation, buildGradeInput, submissionId, t])

  const doRevise = useCallback(
    (reason: string) => {
      reviseMutation.mutate(
        { ...buildGradeInput(), reason },
        {
          onSuccess: () => {
            // Drop the stale draft so the version-bump remount re-seeds from the new
            // grade version instead of shadowing it (chunk-2 review P2).
            clearGradingDraft(submissionId)
            setReviseOpen(false)
            toast.success(t('grading.revise.success'))
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : t('grading.error.generic')),
        },
      )
    },
    [reviseMutation, buildGradeInput, submissionId, t],
  )

  // Prev/next queue nav (arrow keys). The open composer is NOT discarded — it persists
  // in the durable draft and restores on return (AC16, lossless round-trip).
  const currentIndex = queue.findIndex((r) => r.submissionId === submissionId)
  const gradedCount = queue.filter((r) => r.released).length
  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return
      onNavigate(queue[index].submissionId)
    },
    [queue, onNavigate],
  )
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      if (currentIndex < 0) return // not in the (stale) queue → no relative nav (P6)
      if (e.key === 'ArrowRight') goTo(currentIndex + 1)
      if (e.key === 'ArrowLeft') goTo(currentIndex - 1)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [currentIndex, goTo])

  // AC13 — reciprocal pin↔card focus. Delegated on the surface wrapper so the static
  // shell needs no change: a pin click scroll-focuses its CommentCard; hovering a card
  // pulses its pin(s).
  const onSurfaceClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const mark = (e.target as HTMLElement).closest('[data-anchor-index]')
    if (!mark) return
    const index = Number(mark.getAttribute('data-anchor-index'))
    if (!Number.isInteger(index)) return
    const card = surfaceRef.current?.querySelector<HTMLElement>(`[data-testid="comment-card-c-${index}"]`)
    if (card) {
      try {
        card.scrollIntoView({ block: 'nearest' })
      } catch {
        // jsdom / no-layout environments — scroll is a visual nicety, not load-bearing.
      }
    }
    setFocusedIndex(index)
  }, [])
  const pulsePin = useCallback((target: EventTarget | null, on: boolean) => {
    const card = (target as HTMLElement | null)?.closest?.('[data-testid^="comment-card-c-"]')
    const match = card?.getAttribute('data-testid')?.match(/comment-card-c-(\d+)/)
    if (!match) return
    surfaceRef.current
      ?.querySelectorAll<HTMLElement>(`[data-anchor-index="${match[1]}"]`)
      .forEach((m) => m.classList.toggle('cl-anchor-pulse', on))
  }, [])

  const composer = draft.composer

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="writing-grading-page">
      <QueueBar
        current={currentIndex}
        total={queue.length}
        graded={gradedCount}
        error={queueError}
        onPrev={() => goTo(currentIndex - 1)}
        onNext={() => goTo(currentIndex + 1)}
        studentName={view.student.fullName}
      />

      <p className="text-xs text-muted-foreground" data-testid="grading-teacher-preview-note">
        {t('grading.teacherPreview.note')}
      </p>

      <BandInputPanel scores={draft.scores} onChange={setScore} math={math} />

      <AiGradePanel
        submissionId={submissionId}
        rehydratedSuggestion={view.aiSuggestion}
        draftDirty={draftDirty}
        appliedBandCriteria={appliedBandCriteria}
        onAcceptBand={acceptAiBand}
        onAcceptComment={acceptAiComment}
      />

      <div
        ref={surfaceRef}
        onClick={onSurfaceClick}
        onMouseOver={(e) => pulsePin(e.target, true)}
        onMouseOut={(e) => pulsePin(e.target, false)}
      >
        <WritingGradingSurface
          essayHtml={essayHtml}
          comments={anchoredComments}
          score={scoreForSurface}
          onCommentEdit={(id) => setFocusedIndex(Number(id.replace('c-', '')))}
          onCommentResolve={(id) => removeComment(Number(id.replace('c-', '')))}
          onSaveDraft={() => toast.success(t('grading.draft.saved'))}
          onSubmit={() => (alreadyGraded ? setReviseOpen(true) : setConfirmOpen(true))}
        />
      </div>

      {focusedIndex !== null ? (
        <p className="sr-only" role="status">
          {t('grading.comment.focused', { index: focusedIndex + 1 })}
        </p>
      ) : null}

      {composer ? (
        <CommentComposer
          composer={composer}
          onChange={updateComposer}
          onCancel={cancelComposer}
          onCommit={commitComposer}
        />
      ) : null}

      <ReleaseConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        canRelease={allScored}
        pending={gradeMutation.isPending}
        onConfirm={doRelease}
      />
      <ReviseDialog
        open={reviseOpen}
        onOpenChange={setReviseOpen}
        canRelease={allScored}
        pending={reviseMutation.isPending}
        onConfirm={doRevise}
      />
    </div>
  )
}

// --- band inputs + live overall (AC14) ---

function BandInputPanel({
  scores,
  onChange,
  math,
}: {
  scores: Partial<CriterionScores>
  onChange: (key: keyof CriterionScores, value: number) => void
  math: { avg: number; band: number } | null
}) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="grading-band-inputs"
      className="flex flex-wrap items-end gap-4 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4"
      aria-label={t('grading.bands.label')}
    >
      {CRITERION_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <Label htmlFor={`band-${key}`}>{t(`criterion.${key}`)}</Label>
          <BandInput
            id={`band-${key}`}
            testId={`grading-band-${key}`}
            value={scores[key]}
            onCommit={(v) => onChange(key, v)}
          />
        </div>
      ))}
      <div className="ml-auto flex flex-col items-end" data-testid="grading-overall-band">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('grading.overall.label')}
        </span>
        <span className="font-mono text-2xl leading-none text-foreground">
          {math ? math.band.toFixed(1) : '—'}
        </span>
        <span className="text-xs text-muted-foreground" data-testid="grading-overall-math">
          {math ? t('grading.overall.math', { avg: math.avg.toFixed(2), band: math.band.toFixed(1) }) : ''}
        </span>
      </div>
    </section>
  )
}

/**
 * BandInput — a single criterion band field. Keeps a LOCAL string buffer so a teacher
 * can type an intermediate value like "6." (which parses to 6) without React snapping
 * it back and eating the decimal point; the numeric value is committed to the draft
 * only when the buffer is a valid band (chunk-2 review P4).
 */
function BandInput({
  id,
  testId,
  value,
  onCommit,
}: {
  id: string
  testId: string
  value: number | undefined
  onCommit: (value: number) => void
}) {
  // The buffer is the source of truth once mounted; draft.scores[key] only ever
  // changes via this input's onCommit, and every external reseed (queue nav / release
  // / revise) remounts the workspace, so a fresh useState re-initializes from value —
  // no derived-state sync (and no ref-during-render) needed.
  const [buffer, setBuffer] = useState(value === undefined ? '' : String(value))
  // A text input (not type="number") so an intermediate "6." is preserved verbatim —
  // number inputs coerce "6." to "" and eat the decimal point mid-entry (chunk-2 P4).
  return (
    <Input
      id={id}
      data-testid={testId}
      type="text"
      inputMode="decimal"
      aria-valuemin={1}
      aria-valuemax={9}
      value={buffer}
      onChange={(e) => {
        setBuffer(e.target.value)
        const v = Number.parseFloat(e.target.value)
        if (Number.isFinite(v) && isValidBand(v)) onCommit(v)
      }}
      className="w-24"
    />
  )
}

// --- composer popover (AC14/AC15 — durable, controlled) ---

function CommentComposer({
  composer,
  onChange,
  onCancel,
  onCommit,
}: {
  composer: DraftComposer
  onChange: (patch: Partial<DraftComposer>) => void
  onCancel: () => void
  onCommit: () => void
}) {
  const { t } = useTranslation()
  const textRef = useRef<HTMLTextAreaElement | null>(null)

  useEffect(() => {
    textRef.current?.focus()
  }, [])

  return (
    <div
      data-testid="grading-comment-composer"
      role="dialog"
      aria-label={t('grading.comment.composerLabel')}
      className="absolute z-50 w-72 rounded-lg border border-border bg-popover p-3 shadow-lg"
      style={{ top: composer.rectTop, left: composer.rectLeft }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit()
      }}
    >
      <div className="mb-2 flex gap-1" role="radiogroup" aria-label={t('grading.comment.typeLabel')}>
        {(['error', 'praise', 'suggestion'] as const).map((tp) => (
          <Button
            key={tp}
            type="button"
            size="sm"
            variant={composer.type === tp ? 'default' : 'outline'}
            data-testid={`grading-composer-type-${tp}`}
            aria-pressed={composer.type === tp}
            onClick={() => onChange({ type: tp })}
          >
            {t(`grading.comment.type.${tp}`)}
          </Button>
        ))}
      </div>
      <Label htmlFor="composer-criterion" className="text-xs">
        {t('grading.comment.criterionLabel')}
      </Label>
      <select
        id="composer-criterion"
        data-testid="grading-composer-criterion"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm"
        value={composer.criterion}
        onChange={(e) => onChange({ criterion: e.target.value as keyof CriterionScores })}
      >
        {CRITERION_KEYS.map((key) => (
          <option key={key} value={key}>
            {t(`criterion.${key}`)}
          </option>
        ))}
      </select>
      <Textarea
        ref={textRef}
        data-testid="grading-composer-text"
        value={composer.text}
        onChange={(e) => onChange({ text: e.target.value })}
        placeholder={t('grading.comment.placeholder')}
        rows={3}
        className="mb-2"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          {t('grading.comment.cancel')}
        </Button>
        <Button type="button" size="sm" data-testid="grading-composer-commit" onClick={onCommit}>
          {t('grading.comment.add')}
        </Button>
      </div>
    </div>
  )
}

// --- queue bar (AC17) ---

function QueueBar({
  current,
  total,
  graded,
  error,
  onPrev,
  onNext,
  studentName,
}: {
  current: number
  total: number
  graded: number
  error: boolean
  onPrev: () => void
  onNext: () => void
  studentName: string
}) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center justify-between" data-testid="grading-queue-bar">
      <div>
        <h1 className="text-lg font-semibold text-foreground" tabIndex={-1}>
          {studentName}
        </h1>
        <p className="text-xs text-muted-foreground" data-testid="grading-queue-progress">
          {error ? t('grading.queue.error') : t('grading.queue.progress', { graded, total })}
        </p>
      </div>
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          data-testid="grading-queue-prev"
          disabled={current <= 0}
          onClick={onPrev}
        >
          {t('grading.queue.prev')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          data-testid="grading-queue-next"
          disabled={current < 0 || current >= total - 1}
          onClick={onNext}
        >
          {t('grading.queue.next')}
        </Button>
      </div>
    </div>
  )
}

// --- dialogs ---

function ReleaseConfirmDialog({
  open,
  onOpenChange,
  canRelease,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  canRelease: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="grading-release-dialog">
        <DialogHeader>
          <DialogTitle>{t('grading.release.title')}</DialogTitle>
          <DialogDescription>{t('grading.release.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.release.cancel')}
          </Button>
          <Button
            data-testid="grading-release-confirm"
            disabled={!canRelease || pending}
            onClick={onConfirm}
          >
            {t('grading.release.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ReviseDialog({
  open,
  onOpenChange,
  canRelease,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  canRelease: boolean
  pending: boolean
  onConfirm: (reason: string) => void
}) {
  const { t } = useTranslation()
  const [reason, setReason] = useState('')
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="grading-revise-dialog">
        <DialogHeader>
          <DialogTitle>{t('grading.revise.title')}</DialogTitle>
          <DialogDescription>{t('grading.revise.description')}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="revise-reason">{t('grading.revise.reasonLabel')}</Label>
        <Textarea
          id="revise-reason"
          data-testid="grading-revise-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.revise.cancel')}
          </Button>
          <Button
            data-testid="grading-revise-confirm"
            disabled={!canRelease || pending || reason.trim() === ''}
            onClick={() => onConfirm(reason.trim())}
          >
            {t('grading.revise.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- states ---

function GradingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="grading-skeleton">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-96 w-full" />
    </div>
  )
}

function GradingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center" role="alert" data-testid="grading-error">
      <p className="text-sm text-foreground">{message}</p>
      <Button size="sm" onClick={onRetry}>
        {t('grading.error.retry')}
      </Button>
    </div>
  )
}

function NothingToGrade() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-2 p-12 text-center" data-testid="grading-nothing" role="status">
      <p className="text-sm font-medium text-foreground">{t('grading.empty.title')}</p>
      <p className="text-sm text-muted-foreground">{t('grading.empty.body')}</p>
    </div>
  )
}

function DesktopOnlySeam({
  classId,
  assignmentId,
  submissionId,
}: {
  classId: string
  assignmentId: string
  submissionId: string
}) {
  const { t } = useTranslation()
  const link = `${window.location.origin}/classes/${classId}/grading/${assignmentId}/${submissionId}`
  return (
    <div className="flex flex-col items-center gap-3 p-10 text-center" data-testid="grading-desktop-seam" role="status">
      <p className="text-sm font-medium text-foreground">{t('grading.mobileSeam.title')}</p>
      <p className="text-sm text-muted-foreground">{t('grading.mobileSeam.body')}</p>
      <Button
        size="sm"
        variant="outline"
        data-testid="grading-copy-link"
        onClick={() => {
          void navigator.clipboard?.writeText(link)
          toast.success(t('grading.mobileSeam.copied'))
        }}
      >
        {t('grading.mobileSeam.copyLink')}
      </Button>
    </div>
  )
}
