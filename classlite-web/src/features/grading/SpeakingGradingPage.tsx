/**
 * SpeakingGradingPage — Story 6.3a (AC4/AC6/AC7/AC9/AC10/AC12 · D8/D9). The teacher
 * Speaking grading surface (screen s24, desktop-only). Mirrors WritingGradingPage but
 * for audio: an AudioWaveformPlayer instead of the essay pane, timestamp-pinned comments
 * instead of text-anchored ones, and the four Speaking criteria. Wires a DISCRIMINATED
 * speaking draft (D8), the twinned client overall band (over SPEAKING_CRITERION_KEYS),
 * a TIMELINE-shaped rail (sorted by timestampMs, source:'teacher', general zoned — so
 * 6-3c slots AI in without a rebuild, D9), the shared prev/next grading queue, and
 * release/revise.
 *
 * Mounted with key={submissionId} by the dispatcher so a queue nav re-seeds the draft.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useParams } from 'react-router'
import { toast } from 'sonner'

import { AudioWaveformPlayer, type WaveformPin } from '@/components/domain/AudioWaveformPlayer'
import {
  AiMomentCard,
  type AiMomentType,
  type AiSpeakingBandProposal,
  type AiSpeakingCriterionKey,
  type AiSpeakingMomentProposal,
} from '@/components/domain/AISpeakingGradeSuggestion'
import { CommentCard, type CommentType } from '@/components/domain/CommentCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
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
import { cn } from '@/lib/utils'

import { useGradingSubmission, type TeacherGradingView } from './api/useGradingSubmission'
import { useGradingQueue, type GradingQueueRow } from './api/useGradingQueue'
import { useGradeSpeaking, type SpeakingGradeInput } from './api/useGradeSpeaking'
import { useReviseSpeakingGrade } from './api/useReviseSpeakingGrade'
import { useTeacherSubmissionAudioUrl } from './api/useTeacherSubmissionAudioUrl'
import { AiSpeakingGradePanel } from './components/AiSpeakingGradePanel'
import { useAiGradeSpeakingJob } from './hooks/useAiGradeSpeakingJob'
import { isValidBand } from './lib/computeOverallBand'
import {
  computeSpeakingOverallBand,
  SPEAKING_CRITERION_KEYS,
  speakingOverallBandMath,
  type SpeakingCriterionKey,
} from './lib/speakingOverallBand'
import {
  clearSpeakingGradingDraft,
  emptySpeakingGradingDraft,
  useSpeakingGradingDraft,
  type SpeakingDraftComment,
  type SpeakingDraftCommentType,
  type SpeakingGradingDraft,
} from './lib/speakingGradingDraft'

const DEFAULT_COMMENT_TYPE: SpeakingDraftCommentType = 'error'

/** Stable empty proposal list — passed to the rail/waveform while the ready overlay gates
 * the (un-reviewed) AI moments, so the memoized `pins` don't churn on every pending render. */
const EMPTY_MOMENTS: AiSpeakingMomentProposal[] = []

/** Map the wire/draft comment type to the CommentCard taxonomy ('suggestion'→'suggest'). */
function toCardType(type: SpeakingDraftCommentType): CommentType {
  return type === 'suggestion' ? 'suggest' : type
}

/** mm:ss from ms (TS-6 — numbers until this formatter). */
function formatMs(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(total / 60)}:${(total % 60).toString().padStart(2, '0')}`
}

function readDurationMs(view: TeacherGradingView): number {
  const content = view.submission.content as { durationSec?: unknown }
  return typeof content.durationSec === 'number' ? Math.round(content.durationSec * 1000) : 0
}

/** A collision-proof client-only comment id. A length-derived id (`d-${len}-${textLen}`)
 * recurs after a delete, colliding with a persisted id and duplicating React keys / pin
 * markers, and letting one delete remove two comments — so use a UUID (crypto when
 * available, else a time+random fallback for older/insecure runtimes). */
function makeCommentId(): string {
  const c = globalThis.crypto
  if (c && typeof c.randomUUID === 'function') return `d-${c.randomUUID()}`
  return `d-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`
}

/** Seed a draft from an existing (released) speaking grade — the criterion_scores +
 * timestamp comments come back skill-shaped on the read (raw passthrough, D1). */
function draftFromSpeakingGrade(view: TeacherGradingView): () => SpeakingGradingDraft {
  return () => {
    if (!view.grade) return emptySpeakingGradingDraft()
    // criterionScores + comments are a skill-polymorphic union on the wire (Grade
    // oneOf). Narrow on the disjoint speaking keys — this is always a speaking grade
    // on this page, but the guards keep the union type-safe without a cast.
    const cs = view.grade.criterionScores
    const scores: Partial<Record<SpeakingCriterionKey, number>> =
      'fluencyCoherence' in cs ? { ...cs } : {}
    const comments: SpeakingDraftComment[] = view.grade.comments.flatMap((c, i) =>
      'timestampMs' in c
        ? [
            {
              id: `g-${i}`,
              type: c.type,
              criterion: c.criterion,
              timestampMs: c.timestampMs ?? null,
              text: c.text,
              source: 'teacher' as const,
            },
          ]
        : [],
    )
    return { scores, comments, composer: null }
  }
}

export function SpeakingGradingPage() {
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
    return <PreparingSkeleton />
  }

  return (
    <SpeakingGradingWorkspace
      key={`${submissionId}:${view.submission.status}:${view.grade?.version ?? 0}`}
      view={view}
      classId={classId}
      assignmentId={assignmentId}
      submissionId={submissionId}
      queue={queueQuery.data ?? []}
      queueError={queueQuery.isError}
      onNavigate={(sid) => navigate(`/classes/${classId}/grading/${assignmentId}/${sid}`)}
    />
  )
}

interface WorkspaceProps {
  view: TeacherGradingView
  classId: string
  assignmentId: string
  submissionId: string
  queue: GradingQueueRow[]
  queueError: boolean
  onNavigate: (submissionId: string) => void
}

function SpeakingGradingWorkspace({
  view,
  classId,
  assignmentId,
  submissionId,
  queue,
  queueError,
  onNavigate,
}: WorkspaceProps) {
  const { t } = useTranslation()
  const alreadyGraded = view.grade != null
  const seed = useMemo(() => draftFromSpeakingGrade(view), [view])
  const { draft, setDraft: persistDraft } = useSpeakingGradingDraft(
    submissionId,
    alreadyGraded ? seed : undefined,
  )

  // "Touched this session" — flipped by ANY draft mutation through the wrapped setter.
  // `draftDirty` (the AC15 ready-overlay gate) must mean "the teacher started working this
  // session", NOT "the draft has content": a revise/reopen seeded from a released grade has
  // scores+comments but no in-progress work, and would otherwise spuriously hide the first
  // AI result behind the Review? overlay (mirrors the 6.2b patch).
  const [draftTouched, setDraftTouched] = useState(false)
  const setDraft = useCallback(
    (updater: (prev: SpeakingGradingDraft) => SpeakingGradingDraft) => {
      setDraftTouched(true)
      persistDraft(updater)
    },
    [persistDraft],
  )

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [reviseOpen, setReviseOpen] = useState(false)
  // The highlighted pin (rail card ↔ marker, AC6) + a token-guarded seek request the
  // player consumes so a rail-card click drives the playhead.
  const [activePinId, setActivePinId] = useState<string | null>(null)
  const [seekRequest, setSeekRequest] = useState<{ ms: number; token: number } | null>(null)
  const seekTokenRef = useRef(0)

  const durationMs = readDurationMs(view)
  const { refresh } = useTeacherSubmissionAudioUrl(classId, assignmentId, submissionId)
  const gradeMutation = useGradeSpeaking(submissionId)
  const reviseMutation = useReviseSpeakingGrade(submissionId)

  const setScore = useCallback(
    (key: SpeakingCriterionKey, value: number) =>
      setDraft((prev) => ({ ...prev, scores: { ...prev.scores, [key]: value } })),
    [setDraft],
  )
  // P6 — a cleared or invalid band must not leave a stale committed score behind (which
  // would keep allScored true and release a score the teacher thinks they removed).
  const clearScore = useCallback(
    (key: SpeakingCriterionKey) =>
      setDraft((prev) => {
        const scores = { ...prev.scores }
        delete scores[key]
        return { ...prev, scores }
      }),
    [setDraft],
  )

  // Pin-at-playhead → open the composer at that timestamp (AC6).
  const onPinAtPlayhead = useCallback(
    (timestampMs: number) =>
      setDraft((prev) => ({
        ...prev,
        composer: {
          timestampMs,
          type: DEFAULT_COMMENT_TYPE,
          criterion: SPEAKING_CRITERION_KEYS[0],
          text: '',
        },
      })),
    [setDraft],
  )

  const commitComposer = useCallback(() => {
    setDraft((prev) => {
      const c = prev.composer
      if (!c || c.text.trim() === '') return prev
      const text = c.text.trim()
      // Editing an existing comment (AC6) updates it in place; otherwise append a new one
      // with a collision-proof id (P5).
      if (c.editingId) {
        return {
          ...prev,
          comments: prev.comments.map((existing) =>
            existing.id === c.editingId
              ? { ...existing, type: c.type, criterion: c.criterion, timestampMs: c.timestampMs, text }
              : existing,
          ),
          composer: null,
        }
      }
      return {
        ...prev,
        comments: [
          ...prev.comments,
          {
            id: makeCommentId(),
            type: c.type,
            criterion: c.criterion,
            timestampMs: c.timestampMs,
            text,
            source: 'teacher',
          },
        ],
        composer: null,
      }
    })
  }, [setDraft])

  const cancelComposer = useCallback(
    () => setDraft((prev) => ({ ...prev, composer: null })),
    [setDraft],
  )
  const removeComment = useCallback(
    (id: string) => setDraft((prev) => ({ ...prev, comments: prev.comments.filter((c) => c.id !== id) })),
    [setDraft],
  )
  // AC6 — edit a pinned/general comment: reopen the composer seeded from it.
  const editComment = useCallback(
    (id: string) =>
      setDraft((prev) => {
        const target = prev.comments.find((c) => c.id === id)
        if (!target) return prev
        return {
          ...prev,
          composer: {
            editingId: id,
            timestampMs: target.timestampMs,
            type: target.type,
            criterion: target.criterion,
            text: target.text,
          },
        }
      }),
    [setDraft],
  )
  // AC6 — drag a marker to nudge its timestamp.
  const nudgePin = useCallback(
    (id: string, timestampMs: number) =>
      setDraft((prev) => ({
        ...prev,
        comments: prev.comments.map((c) => (c.id === id ? { ...c, timestampMs } : c)),
      })),
    [setDraft],
  )
  // AC6 — a rail card (or marker) click seeks the playhead + highlights the pin.
  const seekToPin = useCallback((id: string, timestampMs: number | null) => {
    setActivePinId(id)
    if (timestampMs !== null) {
      seekTokenRef.current += 1
      setSeekRequest({ ms: timestampMs, token: seekTokenRef.current })
    }
  }, [])

  // --- AI grading (Story 6.3c, SD2/SD3/SD5) ---
  const aiJob = useAiGradeSpeakingJob(submissionId)

  const [dismissedBands, setDismissedBands] = useState<ReadonlySet<AiSpeakingCriterionKey>>(new Set())
  const [dismissedMoments, setDismissedMoments] = useState<ReadonlySet<string>>(new Set())
  const [acceptedMoments, setAcceptedMoments] = useState<ReadonlySet<string>>(new Set())
  // Moment ids currently open in per-card Edit — "Accept all praise" SKIPS these so it
  // never merges the stale AI-original text over a teacher's in-progress edit (6.2b patch).
  const [editingMoments, setEditingMoments] = useState<ReadonlySet<string>>(new Set())
  // Bumped on every confirmed run (onConfirmRun). Moment ids are POSITIONAL (`ai-m-${i}`),
  // so a re-run reuses them; folding the run token into each moment card's React key forces
  // a remount per run — otherwise a card that was mid-Edit (not accepted) in the prior run
  // would keep its stale local text/criterion buffer over the NEW run's moment (review-fix
  // 2026-08-25). Pairs with the `acceptedMoments` reset in onConfirmRun.
  const [runToken, setRunToken] = useState(0)
  // AC15 non-blocking ready overlay state — see the phase-edge block below draftDirty. Lives
  // on the PAGE (single source of truth) so it gates the band strip AND the interleaved
  // moment cards + waveform pins together (review-fix 2026-08-25). Declared here so
  // onConfirmRun (below) can clear it.
  const [aiReviewPending, setAiReviewPending] = useState(false)

  // Two-signal rehydrate (SD3): the LIVE completed result when the poll is done, else the
  // class-shared `view.aiSpeakingSuggestion`. A non-triggering co-teacher has no local job
  // (phase 'idle' + jobId null → the poll query is disabled), so they read the class-shared
  // suggestion and NEVER poll a creator-private job (AC13).
  //
  // Review-fix 2026-08-25: fall back to `view.aiSpeakingSuggestion` on every non-`ready`
  // phase EXCEPT `generating` — so a re-run that ends `failed`/`stuck` keeps the still-valid
  // prior suggestion visible (the teacher no longer loses it and must pay again to see it).
  // `generating` alone hides it, so the fresh run shows only the skeleton (never the old
  // band strip stacked under a "generating" spinner) until the new result supersedes it.
  const liveResult = aiJob.phase === 'ready' ? aiJob.result : null
  const suggestion = liveResult ?? (aiJob.phase === 'generating' ? null : view.aiSpeakingSuggestion)
  const hasExistingSuggestion = view.aiSpeakingSuggestion !== null || aiJob.phase === 'ready'

  // Criteria already scored in the durable draft render as "Applied" in the AI strip (never
  // re-offered), so a reopen can't clobber a manual edit of that band (6.2b patch).
  const appliedBandCriteria = useMemo(
    () => new Set(SPEAKING_CRITERION_KEYS.filter((key) => draft.scores[key] !== undefined)),
    [draft.scores],
  )

  const bandProposals: AiSpeakingBandProposal[] = suggestion
    ? SPEAKING_CRITERION_KEYS.map((key) => ({
        criterion: key,
        band: suggestion.criteria[key].band,
        rationale: suggestion.criteria[key].rationale,
        confidence: suggestion.criteria[key].confidence,
        accepted: appliedBandCriteria.has(key),
      })).filter((p) => !dismissedBands.has(p.criterion))
    : []

  const overallBand = suggestion
    ? computeSpeakingOverallBand({
        fluencyCoherence: suggestion.criteria.fluencyCoherence.band,
        lexicalResource: suggestion.criteria.lexicalResource.band,
        grammaticalRange: suggestion.criteria.grammaticalRange.band,
        pronunciation: suggestion.criteria.pronunciation.band,
      })
    : 0

  // All moment proposals (stable ids) — the lookup source for Accept + dedup.
  const allMomentProposals: AiSpeakingMomentProposal[] = useMemo(
    () =>
      suggestion
        ? suggestion.moments.map((m, i) => ({
            id: `ai-m-${i}`,
            type: m.type,
            criterion: m.criterion,
            timestampMs: m.timestampMs,
            text: m.text,
            confidence: m.confidence,
          }))
        : [],
    [suggestion],
  )

  // A proposal already merged into the persisted draft (a prior session's accept) — its
  // original (timestampMs,text,criterion) matches a source:'ai' draft comment. Dedup on
  // reopen so it is not re-offered nor duplicated (AC12).
  const isMomentMerged = useCallback(
    (m: AiSpeakingMomentProposal) =>
      draft.comments.some(
        (c) =>
          c.source === 'ai' &&
          c.criterion === m.criterion &&
          c.text === m.text &&
          c.timestampMs === m.timestampMs,
      ),
    [draft.comments],
  )

  // The un-accepted, non-dismissed proposals that render inline in the rail (AC6). An
  // accepted moment leaves this list (it now lives in draft.comments as a source:'ai' card).
  const momentProposals = allMomentProposals.filter(
    (m) => !dismissedMoments.has(m.id) && !acceptedMoments.has(m.id) && !isMomentMerged(m),
  )
  // Mirror the `acceptAllPraise` filter EXACTLY (it also skips in-edit cards) so the
  // "Accept all praise" button never renders when clicking it would be a no-op (a card
  // mid-edit is excluded from the batch). `momentProposals` already drops dismissed /
  // accepted / merged; the extra guard here is the `editingMoments` skip.
  const hasUnacceptedPraise = momentProposals.some(
    (m) => m.type === 'praise' && !editingMoments.has(m.id),
  )

  const acceptAiBand = useCallback(
    (key: AiSpeakingCriterionKey, band: number) => setScore(key, band),
    [setScore],
  )
  const dismissAiBand = useCallback(
    (key: AiSpeakingCriterionKey) => setDismissedBands((prev) => new Set(prev).add(key)),
    [],
  )

  // Accept an AI moment: append a SpeakingDraftComment{source:'ai'} — confidence is DROPPED
  // (never carried into the draft, so it can never reach `grades` — UX-DR22/AC9). timestampMs
  // comes from the original proposal (the card only edits type/criterion/text).
  const acceptAiMoment = useCallback(
    (id: string, next: { type: AiMomentType; criterion: AiSpeakingCriterionKey; text: string }) => {
      const proposal = allMomentProposals.find((m) => m.id === id)
      if (!proposal) return
      setDraft((prev) => {
        const already = prev.comments.some(
          (c) =>
            c.source === 'ai' &&
            c.criterion === next.criterion &&
            c.text === next.text &&
            c.timestampMs === proposal.timestampMs,
        )
        if (already) return prev
        return {
          ...prev,
          comments: [
            ...prev.comments,
            {
              id: makeCommentId(),
              type: next.type,
              criterion: next.criterion,
              timestampMs: proposal.timestampMs,
              text: next.text,
              source: 'ai',
            },
          ],
        }
      })
      setAcceptedMoments((prev) => new Set(prev).add(id))
    },
    [allMomentProposals, setDraft],
  )
  const dismissAiMoment = useCallback(
    (id: string) => setDismissedMoments((prev) => new Set(prev).add(id)),
    [],
  )
  const onMomentEditingChange = useCallback(
    (id: string, editing: boolean) =>
      setEditingMoments((prev) => {
        const next = new Set(prev)
        if (editing) next.add(id)
        else next.delete(id)
        return next
      }),
    [],
  )

  // "Accept all praise" — accept every un-accepted, non-dismissed, non-editing praise moment
  // in one action; other types untouched; a card mid-edit is SKIPPED so its buffer is not
  // silently discarded (6.2b patch). One batched draft update + accepted-set update.
  const acceptAllPraise = useCallback(() => {
    const toAccept = allMomentProposals.filter(
      (m) =>
        m.type === 'praise' &&
        !acceptedMoments.has(m.id) &&
        !dismissedMoments.has(m.id) &&
        !editingMoments.has(m.id) &&
        !isMomentMerged(m),
    )
    if (toAccept.length === 0) return
    setDraft((prev) => {
      const comments = [...prev.comments]
      for (const m of toAccept) {
        const already = comments.some(
          (c) =>
            c.source === 'ai' &&
            c.criterion === m.criterion &&
            c.text === m.text &&
            c.timestampMs === m.timestampMs,
        )
        if (already) continue
        comments.push({
          id: makeCommentId(),
          type: m.type,
          criterion: m.criterion,
          timestampMs: m.timestampMs,
          text: m.text,
          source: 'ai',
        })
      }
      return { ...prev, comments }
    })
    setAcceptedMoments((prev) => {
      const next = new Set(prev)
      for (const m of toAccept) next.add(m.id)
      return next
    })
  }, [allMomentProposals, acceptedMoments, dismissedMoments, editingMoments, isMomentMerged, setDraft])

  const onConfirmRun = useCallback(() => {
    setDismissedBands(new Set())
    setDismissedMoments(new Set())
    // Reset acceptedMoments too (it was previously left intact): with positional ids a
    // surviving `ai-m-0` would otherwise filter out the NEW run's first moment, silently
    // hiding a paid suggestion (review-fix 2026-08-25). Accepted work is already committed
    // as source:'ai' draft comments and survives independently.
    setAcceptedMoments(new Set())
    setEditingMoments(new Set())
    setRunToken((n) => n + 1)
    // A new run's suggestion must never stay hidden behind a stale ready overlay.
    setAiReviewPending(false)
    aiJob.enqueue()
  }, [aiJob])

  // Session-edited gate for the non-blocking ready overlay (AC15) — NOT "draft has content".
  const draftDirty = draftTouched || draft.composer !== null

  // AC15 non-blocking ready overlay (review-fix 2026-08-25 — the gate now lives on the PAGE,
  // the single source of truth, so it withholds BOTH the panel band strip AND the
  // interleaved moment cards + waveform pins until the teacher opts in; previously the panel
  // gated only its own band strip while the moments/pins appeared immediately). A completion
  // while the draft is dirty raises the overlay; Review (or a fresh run) clears it. Uses the
  // React-sanctioned "adjust state while rendering" pattern on the phase rising edge.
  const [prevAiPhase, setPrevAiPhase] = useState(aiJob.phase)
  if (prevAiPhase !== aiJob.phase) {
    setPrevAiPhase(aiJob.phase)
    if (aiJob.phase === 'ready' && draftDirty) setAiReviewPending(true)
  }
  const reviewSuggestion = useCallback(() => setAiReviewPending(false), [])

  // While the overlay is pending, withhold the un-accepted AI moment proposals from BOTH the
  // rail and the waveform (they reveal together with the band strip on Review).
  const revealedMoments = aiReviewPending ? EMPTY_MOMENTS : momentProposals

  // Merged waveform markers (SD6): teacher/accepted-AI draft-comment pins (with their
  // source) ∪ un-accepted AI moment proposal pins (source 'ai'). A null-timestamp item
  // gets no marker (it lives in the rail's general zone only).
  const pins: WaveformPin[] = useMemo(
    () => [
      ...draft.comments
        .filter((c) => c.timestampMs !== null)
        .map((c) => ({ id: c.id, timestampMs: c.timestampMs as number, source: c.source })),
      ...revealedMoments
        .filter((m) => m.timestampMs !== null)
        .map((m) => ({ id: m.id, timestampMs: m.timestampMs as number, source: 'ai' as const })),
    ],
    [draft.comments, revealedMoments],
  )

  const math = useMemo(() => speakingOverallBandMath(draft.scores), [draft.scores])
  const allScored = SPEAKING_CRITERION_KEYS.every((k) => typeof draft.scores[k] === 'number')

  const buildSpeakingGradeInput = useCallback((): SpeakingGradeInput => {
    return {
      criterionScores: {
        fluencyCoherence: draft.scores.fluencyCoherence ?? 0,
        lexicalResource: draft.scores.lexicalResource ?? 0,
        grammaticalRange: draft.scores.grammaticalRange ?? 0,
        pronunciation: draft.scores.pronunciation ?? 0,
      },
      // Strip the client-only id + source; timestampMs null ⇒ a general comment.
      comments: draft.comments.map((c) => ({
        type: c.type,
        criterion: c.criterion,
        timestampMs: c.timestampMs,
        text: c.text,
      })),
      feedback: null,
    }
  }, [draft])

  const doRelease = useCallback(() => {
    gradeMutation.mutate(buildSpeakingGradeInput(), {
      onSuccess: () => {
        clearSpeakingGradingDraft(submissionId)
        setConfirmOpen(false)
        toast.success(t('grading.release.success'))
      },
      onError: (err) => toast.error(err instanceof ApiError ? err.message : t('grading.error.generic')),
    })
  }, [gradeMutation, buildSpeakingGradeInput, submissionId, t])

  const doRevise = useCallback(
    (reason: string) => {
      reviseMutation.mutate(
        { ...buildSpeakingGradeInput(), reason },
        {
          onSuccess: () => {
            clearSpeakingGradingDraft(submissionId)
            setReviseOpen(false)
            toast.success(t('grading.revise.success'))
          },
          onError: (err) => toast.error(err instanceof ApiError ? err.message : t('grading.error.generic')),
        },
      )
    },
    [reviseMutation, buildSpeakingGradeInput, submissionId, t],
  )

  const currentIndex = queue.findIndex((r) => r.submissionId === submissionId)
  const gradedCount = queue.filter((r) => r.released).length
  const goTo = useCallback(
    (index: number) => {
      if (index < 0 || index >= queue.length) return
      onNavigate(queue[index].submissionId)
    },
    [queue, onNavigate],
  )

  // AC9 — arrow-key queue nav + Escape-to-queue, with focus arbitration: form fields, the
  // waveform transport (its own ←/→ seek + Space), and open dialogs keep their own keys;
  // the queue nav only fires from the page background (mirrors WritingGradingPage).
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target) {
        const tag = target.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable) return
        if (target.closest('[data-testid="waveform-transport"]')) return
        if (target.closest('[role="dialog"]')) return
      }
      if (event.key === 'ArrowRight') goTo(currentIndex + 1)
      else if (event.key === 'ArrowLeft') goTo(currentIndex - 1)
      else if (event.key === 'Escape') {
        document
          .querySelector<HTMLElement>('[data-testid="speaking-grading-queue-bar"] h1')
          ?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [currentIndex, goTo])

  const composer = draft.composer

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="speaking-grading-page">
      <QueueBar
        current={currentIndex}
        total={queue.length}
        graded={gradedCount}
        error={queueError}
        onPrev={() => goTo(currentIndex - 1)}
        onNext={() => goTo(currentIndex + 1)}
        studentName={view.student.fullName}
      />

      <p className="text-xs text-muted-foreground">{t('grading.teacherPreview.note')}</p>

      {view.audioStatus === 'hasAudio' && view.audioUrl ? (
        <AudioWaveformPlayer
          audioUrl={view.audioUrl}
          durationMs={durationMs}
          pins={pins}
          activePinId={activePinId}
          onPinAtPlayhead={onPinAtPlayhead}
          onSeekToPin={setActivePinId}
          onNudgePin={nudgePin}
          seekToMs={seekRequest}
          onRefreshUrl={refresh}
        />
      ) : (
        <div
          data-testid="speaking-grading-no-audio"
          role="status"
          className="rounded-2xl border border-dashed border-border bg-muted/40 p-8 text-center text-sm text-muted-foreground"
        >
          {t('speakingGrading.state.reRecord')}
        </div>
      )}

      <SpeakingBandInputs scores={draft.scores} onChange={setScore} onClear={clearScore} math={math} />

      <AiSpeakingGradePanel
        aiJob={aiJob}
        suggestion={suggestion}
        hasExistingSuggestion={hasExistingSuggestion}
        reviewPending={aiReviewPending}
        onReview={reviewSuggestion}
        bands={bandProposals}
        overallBand={overallBand}
        hasUnacceptedPraise={hasUnacceptedPraise}
        onConfirmRun={onConfirmRun}
        onAcceptBand={acceptAiBand}
        onDismissBand={dismissAiBand}
        onAcceptAllPraise={acceptAllPraise}
      />

      <NotesRail
        comments={draft.comments}
        aiMoments={revealedMoments}
        momentRunToken={runToken}
        activePinId={activePinId}
        onDelete={removeComment}
        onEdit={editComment}
        onSeek={seekToPin}
        onAcceptMoment={acceptAiMoment}
        onDismissMoment={dismissAiMoment}
        onMomentEditingChange={onMomentEditingChange}
      />

      <div className="flex justify-end">
        <Button
          data-testid="speaking-grading-submit"
          onClick={() => (alreadyGraded ? setReviseOpen(true) : setConfirmOpen(true))}
        >
          {alreadyGraded ? t('grading.revise.title') : t('grading.release.title')}
        </Button>
      </div>

      {composer ? (
        <CommentComposer
          composer={composer}
          onChange={(patch) =>
            setDraft((prev) => (prev.composer ? { ...prev, composer: { ...prev.composer, ...patch } } : prev))
          }
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

// --- band inputs (2×2 speaking criteria) + live overall (AC4) ---

function SpeakingBandInputs({
  scores,
  onChange,
  onClear,
  math,
}: {
  scores: Partial<Record<SpeakingCriterionKey, number>>
  onChange: (key: SpeakingCriterionKey, value: number) => void
  onClear: (key: SpeakingCriterionKey) => void
  math: { avg: number; band: number } | null
}) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="speaking-grading-band-inputs"
      aria-label={t('speakingGrading.criteria.title')}
      className="grid grid-cols-1 gap-4 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4 md:grid-cols-2"
    >
      {SPEAKING_CRITERION_KEYS.map((key) => (
        <div key={key} className="flex flex-col gap-1">
          <Label htmlFor={`band-${key}`}>{t(`criterion.${key}`)}</Label>
          <BandInput
            id={`band-${key}`}
            testId={`speaking-band-${key}`}
            value={scores[key]}
            onCommit={(v) => onChange(key, v)}
            onClear={() => onClear(key)}
          />
        </div>
      ))}
      <div className="md:col-span-2 flex flex-col items-end" data-testid="speaking-grading-overall-band">
        <span className="text-xs uppercase tracking-wide text-muted-foreground">
          {t('grading.overall.label')}
        </span>
        <span className="font-mono text-2xl leading-none text-foreground">
          {math ? math.band.toFixed(1) : '—'}
        </span>
        <span className="text-xs text-muted-foreground">
          {math ? t('grading.overall.math', { avg: math.avg.toFixed(2), band: math.band.toFixed(1) }) : ''}
        </span>
      </div>
    </section>
  )
}

function BandInput({
  id,
  testId,
  value,
  onCommit,
  onClear,
}: {
  id: string
  testId: string
  value: number | undefined
  onCommit: (value: number) => void
  onClear: () => void
}) {
  const [buffer, setBuffer] = useState(value === undefined ? '' : String(value))
  const [invalid, setInvalid] = useState(false)
  return (
    <Input
      id={id}
      data-testid={testId}
      type="text"
      inputMode="decimal"
      aria-valuemin={1}
      aria-valuemax={9}
      aria-invalid={invalid || undefined}
      value={buffer}
      onChange={(e) => {
        const raw = e.target.value
        setBuffer(raw)
        // Keep the committed score in lock-step with what's shown (P6): empty clears it,
        // a valid on-grid band commits, and an off-grid/garbage value clears it AND flags
        // invalid — so release never persists a phantom the teacher can't see.
        if (raw.trim() === '') {
          setInvalid(false)
          onClear()
          return
        }
        const v = Number.parseFloat(raw)
        if (Number.isFinite(v) && isValidBand(v)) {
          setInvalid(false)
          onCommit(v)
        } else {
          setInvalid(true)
          onClear()
        }
      }}
      className={cn('w-24', invalid && 'border-destructive focus-visible:ring-destructive')}
    />
  )
}

// --- timeline-shaped notes rail (D9: sorted by timestampMs, general zoned) ---
//
// Story 6.3c (SD5): the rail now INTERLEAVES un-accepted AI moment proposals with the
// teacher's own (and accepted-AI) draft comments, sorted chronologically by timestampMs —
// the epic's "AI + teacher notes together on the timeline" (epic AC L198). A teacher/
// accepted-AI comment renders as the shipped `CommentCard`; an un-accepted AI proposal
// renders as an `AiMomentCard` (Accept/Edit/Dismiss). A null-timestamp item of either kind
// falls into the general (unpinned) zone — never dropped (AC6).

type RailEntry =
  | { kind: 'comment'; ts: number | null; comment: SpeakingDraftComment }
  | { kind: 'moment'; ts: number | null; moment: AiSpeakingMomentProposal }

function NotesRail({
  comments,
  aiMoments,
  momentRunToken,
  activePinId,
  onDelete,
  onEdit,
  onSeek,
  onAcceptMoment,
  onDismissMoment,
  onMomentEditingChange,
}: {
  comments: SpeakingDraftComment[]
  aiMoments: AiSpeakingMomentProposal[]
  /** Bumped per confirmed run — folded into each moment card's React key so a re-run
   * remounts the card (clearing its stale per-card Edit buffer). See runToken above. */
  momentRunToken: number
  activePinId: string | null
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  onSeek: (id: string, timestampMs: number | null) => void
  onAcceptMoment: (
    id: string,
    next: { type: AiMomentType; criterion: AiSpeakingCriterionKey; text: string },
  ) => void
  onDismissMoment: (id: string) => void
  onMomentEditingChange: (id: string, editing: boolean) => void
}) {
  const { t } = useTranslation()

  const entries: RailEntry[] = [
    ...comments.map((c): RailEntry => ({ kind: 'comment', ts: c.timestampMs, comment: c })),
    ...aiMoments.map((m): RailEntry => ({ kind: 'moment', ts: m.timestampMs, moment: m })),
  ]
  const pinned = entries
    .filter((e) => e.ts !== null)
    .sort((a, b) => (a.ts as number) - (b.ts as number))
  const general = entries.filter((e) => e.ts === null)

  const renderEntry = (entry: RailEntry) => {
    if (entry.kind === 'moment') {
      return (
        <li key={`m-${momentRunToken}-${entry.moment.id}`}>
          <AiMomentCard
            moment={entry.moment}
            active={activePinId === entry.moment.id}
            onSeek={onSeek}
            onAccept={onAcceptMoment}
            onDismiss={onDismissMoment}
            onEditingChange={onMomentEditingChange}
          />
        </li>
      )
    }
    const c = entry.comment
    return (
      <li
        key={c.id}
        data-testid={`rail-item-${c.id}`}
        data-active={activePinId === c.id ? 'true' : undefined}
        className={cn('flex flex-col gap-1 rounded-lg', activePinId === c.id && 'ring-2 ring-ring')}
      >
        {c.timestampMs !== null ? (
          // AC6 — the timestamp seeks the playhead + highlights this pin.
          <button
            type="button"
            data-testid={`rail-seek-${c.id}`}
            onClick={() => onSeek(c.id, c.timestampMs)}
            aria-label={t('speakingGrading.pin.markerLabel', { time: formatMs(c.timestampMs) })}
            className="self-start font-mono text-xs font-medium text-primary underline underline-offset-2"
          >
            {formatMs(c.timestampMs)}
          </button>
        ) : null}
        <CommentCard
          type={toCardType(c.type)}
          criterionKey={`criterion.${c.criterion}`}
          body={c.text}
          testIdSlug={c.id}
          onResolve={() => onDelete(c.id)}
          onEdit={() => onEdit(c.id)}
        />
      </li>
    )
  }

  return (
    <section
      data-testid="speaking-grading-rail"
      aria-label={t('speakingGrading.rail.title')}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {t('speakingGrading.rail.title')}
      </h2>
      {entries.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('speakingGrading.rail.empty')}
        </p>
      ) : (
        <>
          {/* Pinned entries render as a flat sequence: a `li` (teacher/accepted-AI comment)
              or an `AiMomentCard` (`article`) — both valid flow children of the `ol`. */}
          <ol className="flex flex-col gap-3">{pinned.map(renderEntry)}</ol>
          {general.length > 0 ? (
            <div className="flex flex-col gap-3" data-testid="speaking-grading-general-zone">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('speakingGrading.rail.generalZone')}
              </h3>
              <ol className="flex flex-col gap-3">{general.map(renderEntry)}</ol>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}

// --- composer (durable, AC6) ---

function CommentComposer({
  composer,
  onChange,
  onCancel,
  onCommit,
}: {
  composer: NonNullable<SpeakingGradingDraft['composer']>
  onChange: (patch: Partial<NonNullable<SpeakingGradingDraft['composer']>>) => void
  onCancel: () => void
  onCommit: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      data-testid="speaking-comment-composer"
      role="dialog"
      aria-label={t('speakingGrading.pin.here')}
      className="rounded-lg border border-border bg-popover p-3 shadow-lg"
    >
      <div className="mb-2 flex gap-1" role="radiogroup" aria-label={t('grading.comment.typeLabel')}>
        {(['error', 'praise', 'suggestion'] as const).map((tp) => (
          <Button
            key={tp}
            type="button"
            size="sm"
            variant={composer.type === tp ? 'default' : 'outline'}
            aria-pressed={composer.type === tp}
            onClick={() => onChange({ type: tp })}
          >
            {t(`grading.comment.type.${tp}`)}
          </Button>
        ))}
      </div>
      <Label htmlFor="speaking-composer-criterion" className="text-xs">
        {t('grading.comment.criterionLabel')}
      </Label>
      <select
        id="speaking-composer-criterion"
        data-testid="speaking-composer-criterion"
        className="mb-2 w-full rounded border border-border bg-background px-2 py-1 text-sm"
        value={composer.criterion}
        onChange={(e) => onChange({ criterion: e.target.value as SpeakingCriterionKey })}
      >
        {SPEAKING_CRITERION_KEYS.map((key) => (
          <option key={key} value={key}>
            {t(`criterion.${key}`)}
          </option>
        ))}
      </select>
      <Textarea
        data-testid="speaking-composer-text"
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
        <Button type="button" size="sm" data-testid="speaking-composer-commit" onClick={onCommit}>
          {t('grading.comment.add')}
        </Button>
      </div>
    </div>
  )
}

// --- queue bar (AC9) ---

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
    <div className="flex items-center justify-between" data-testid="speaking-grading-queue-bar">
      <div>
        <h1 className="text-lg font-semibold text-foreground" tabIndex={-1}>
          {studentName}
        </h1>
        <p className="text-xs text-muted-foreground">
          {error ? t('grading.queue.error') : t('grading.queue.progress', { graded, total })}
        </p>
      </div>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={current <= 0} onClick={onPrev}>
          {t('grading.queue.prev')}
        </Button>
        <Button size="sm" variant="outline" disabled={current < 0 || current >= total - 1} onClick={onNext}>
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
      <DialogContent data-testid="speaking-release-dialog">
        <DialogHeader>
          <DialogTitle>{t('grading.release.title')}</DialogTitle>
          <DialogDescription>{t('grading.release.description')}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.release.cancel')}
          </Button>
          <Button data-testid="speaking-release-confirm" disabled={!canRelease || pending} onClick={onConfirm}>
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
      <DialogContent data-testid="speaking-revise-dialog">
        <DialogHeader>
          <DialogTitle>{t('grading.revise.title')}</DialogTitle>
          <DialogDescription>{t('grading.revise.description')}</DialogDescription>
        </DialogHeader>
        <Label htmlFor="speaking-revise-reason">{t('grading.revise.reasonLabel')}</Label>
        <Textarea
          id="speaking-revise-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.revise.cancel')}
          </Button>
          <Button
            data-testid="speaking-revise-confirm"
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

function PreparingSkeleton() {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="speaking-grading-skeleton" role="status">
      <span className="text-sm text-muted-foreground">{t('speakingGrading.state.preparingAudio')}</span>
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

function GradingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex flex-col items-center gap-3 p-12 text-center" role="alert" data-testid="speaking-grading-error">
      <p className="text-sm text-foreground">{message}</p>
      <Button size="sm" onClick={onRetry}>
        {t('grading.error.retry')}
      </Button>
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
    <div className="flex flex-col items-center gap-3 p-10 text-center" data-testid="speaking-grading-desktop-seam" role="status">
      <p className="text-sm font-medium text-foreground">{t('grading.mobileSeam.title')}</p>
      <p className="text-sm text-muted-foreground">{t('grading.mobileSeam.body')}</p>
      <Button
        size="sm"
        variant="outline"
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
