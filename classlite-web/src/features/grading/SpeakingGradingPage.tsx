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
import { isValidBand } from './lib/computeOverallBand'
import {
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
  const { draft, setDraft } = useSpeakingGradingDraft(submissionId, alreadyGraded ? seed : undefined)

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

  const pins: WaveformPin[] = useMemo(
    () =>
      draft.comments
        .filter((c) => c.timestampMs !== null)
        .map((c) => ({ id: c.id, timestampMs: c.timestampMs as number })),
    [draft.comments],
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

      <NotesRail
        comments={draft.comments}
        activePinId={activePinId}
        onDelete={removeComment}
        onEdit={editComment}
        onSeek={seekToPin}
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

function NotesRail({
  comments,
  activePinId,
  onDelete,
  onEdit,
  onSeek,
}: {
  comments: SpeakingDraftComment[]
  activePinId: string | null
  onDelete: (id: string) => void
  onEdit: (id: string) => void
  onSeek: (id: string, timestampMs: number | null) => void
}) {
  const { t } = useTranslation()
  const pinned = comments
    .filter((c) => c.timestampMs !== null)
    .sort((a, b) => (a.timestampMs as number) - (b.timestampMs as number))
  const general = comments.filter((c) => c.timestampMs === null)

  return (
    <section
      data-testid="speaking-grading-rail"
      aria-label={t('speakingGrading.rail.title')}
      className="flex flex-col gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4"
    >
      <h2 className="text-xs font-semibold uppercase tracking-wide text-foreground">
        {t('speakingGrading.rail.title')}
      </h2>
      {comments.length === 0 ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('speakingGrading.rail.empty')}
        </p>
      ) : (
        <>
          <ol className="flex flex-col gap-3">
            {pinned.map((c) => (
              <li
                key={c.id}
                data-testid={`rail-item-${c.id}`}
                data-active={activePinId === c.id ? 'true' : undefined}
                className={cn('flex flex-col gap-1 rounded-lg', activePinId === c.id && 'ring-2 ring-ring')}
              >
                {/* AC6 — the timestamp seeks the playhead + highlights this pin. */}
                <button
                  type="button"
                  data-testid={`rail-seek-${c.id}`}
                  onClick={() => onSeek(c.id, c.timestampMs)}
                  aria-label={t('speakingGrading.pin.markerLabel', {
                    time: formatMs(c.timestampMs as number),
                  })}
                  className="self-start font-mono text-xs font-medium text-primary underline underline-offset-2"
                >
                  {formatMs(c.timestampMs as number)}
                </button>
                <CommentCard
                  type={toCardType(c.type)}
                  criterionKey={`criterion.${c.criterion}`}
                  body={c.text}
                  testIdSlug={c.id}
                  onResolve={() => onDelete(c.id)}
                  onEdit={() => onEdit(c.id)}
                />
              </li>
            ))}
          </ol>
          {general.length > 0 ? (
            <div className="flex flex-col gap-3" data-testid="speaking-grading-general-zone">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {t('speakingGrading.rail.generalZone')}
              </h3>
              <ol className="flex flex-col gap-3">
                {general.map((c) => (
                  <li key={c.id}>
                    <CommentCard
                      type={toCardType(c.type)}
                      criterionKey={`criterion.${c.criterion}`}
                      body={c.text}
                      testIdSlug={c.id}
                      onResolve={() => onDelete(c.id)}
                      onEdit={() => onEdit(c.id)}
                    />
                  </li>
                ))}
              </ol>
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
