/**
 * ObjectiveGradingPage — Story 6.4b (AC1-AC12 · D1-D10). The teacher s25 review surface
 * for an auto-graded objective (reading/listening/grammar, incl. vocabulary-skill)
 * submission. Third branch of GradingRoute, dispatched by `autoGrade != null` (D1).
 *
 * The server is authoritative on ALL scoring (D3) — this page renders `AutoGradeView`
 * numbers verbatim and NEVER recomputes a percentage/band/denominator. A single-click
 * override (D5, no RHF) POSTs one answer's mark and the server returns the full recomputed
 * breakdown, which seeds the cache (After-overrides updates before the invalidation
 * refetch, AC8). Release is irreversible + notifies the student (D4); when unresolved
 * needs_review > 0 the confirm dialog shows the provisional→released band reckoning read
 * VERBATIM from `autoGrade.releasedProjection` (D9/#1=A). Post-release the breakdown is
 * read-only (AC12). Desktop-only (D6); mirrors SpeakingGradingPage's wrapper/trilogy.
 *
 * The grading queue (prev/next) is intentionally not wired here — no AC covers it and the
 * s25 review is opened per-submission; the shared QueueBar can be layered later.
 */
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useParams } from 'react-router'
import { toast } from 'sonner'

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
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { ApiError } from '@/lib/api-fetch'
import { cn } from '@/lib/utils'
import { flattenQuestions } from '@/features/quiz-attempt'

import { useGradingSubmission, type TeacherGradingView } from './api/useGradingSubmission'
import {
  useOverrideAutoGradeAnswer,
  type AutoGradeView,
} from './api/useOverrideAutoGradeAnswer'
import { useReleaseAutoGrade } from './api/useReleaseAutoGrade'

type AutoGradeAnswerView = AutoGradeView['answers'][number]

/** Map an override/release ApiError.code to its DISTINCT toast key — the three 409s share
 * a status but must not collapse to one message (AC9/AC11 — discriminate on code). */
function objectiveErrorKey(error: unknown): string {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'SUBMISSION_ALREADY_RELEASED':
        return 'objectiveGrading.error.alreadyReleased'
      case 'SUBMISSION_NOT_OBJECTIVE':
        return 'objectiveGrading.error.notObjective'
      case 'AUTO_GRADE_NOT_FOUND':
        return 'objectiveGrading.error.autoGradeNotFound'
      case 'INVALID_QUESTION_REF':
        return 'objectiveGrading.error.invalidQuestionRef'
      case 'SUBMISSION_NOT_FOUND':
        return 'objectiveGrading.error.submissionNotFound'
    }
  }
  return 'grading.error.generic'
}

/** Bands always display one decimal (IELTS half-band grid) so 9 reads as "9.0", not "9". */
function formatBand(band: number): string {
  return band.toFixed(1)
}

/** Stable DOM id for an answer row, keyed by its colon handle — the jump-to-first-flagged
 * target. Kept distinct from the data-testid so prod navigation isn't coupled to test hooks. */
function objectiveRowId(questionRef: string): string {
  return `objective-row-anchor-${questionRef}`
}

/** effectiveMark drives the row's chip + the correct-answer reveal (D3/D5). */
type Mark = AutoGradeAnswerView['effectiveMark']

function markKey(mark: Mark): string {
  if (mark === 'wrong') return 'objectiveGrading.mark.wrong'
  if (mark === 'needs_review') return 'objectiveGrading.mark.needsReview'
  return 'objectiveGrading.mark.correct'
}

export function ObjectiveGradingPage() {
  const { t } = useTranslation()
  const params = useParams()
  const submissionId = params.sid ?? ''

  const isDesktop = useIsDesktop()
  const query = useGradingSubmission(submissionId)

  if (!isDesktop) {
    return <DesktopOnlySeam />
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
  if (!view || !view.autoGrade) {
    return <PreparingSkeleton />
  }

  // Composite-key remount on release re-seeds the definitive read-only state (D4 — trimmed
  // key; submission.status is collinear with `released`, dropped as a redundant passenger).
  return (
    <ObjectiveGradingWorkspace
      key={`${submissionId}:${view.autoGrade.released}`}
      view={view}
      submissionId={submissionId}
    />
  )
}

function ObjectiveGradingWorkspace({
  view,
  submissionId,
}: {
  view: TeacherGradingView
  submissionId: string
}) {
  const { t } = useTranslation()
  const autoGrade = view.autoGrade as AutoGradeView
  const readOnly = autoGrade.released

  const overrideMutation = useOverrideAutoGradeAnswer(submissionId)
  const releaseMutation = useReleaseAutoGrade(submissionId)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const overridePending = overrideMutation.isPending
  // Lock the whole surface from a SUCCESSFUL release through the composite-key remount (D4):
  // between the release resolving and the refetch flipping `released`, the page is still
  // interactive, and a second release 409s / an override hits the immutability trigger. Also
  // lock during a pending override so an irreversible release can NEVER commit the definitive
  // grade WITHOUT the teacher's in-flight correction (the row buttons already guard on this).
  const releaseInFlight = releaseMutation.isPending || releaseMutation.isSuccess
  const locked = overridePending || releaseInFlight

  // Rows follow the exercise document order (AC7) — key each flattened question by its
  // colon handle to the server answer, never the (possibly scrambled) answers array order.
  const answersByRef = useMemo(() => {
    const map = new Map<string, AutoGradeAnswerView>()
    for (const answer of autoGrade.answers) map.set(answer.questionRef, answer)
    return map
  }, [autoGrade.answers])
  const rows = useMemo(
    () =>
      flattenQuestions(view.exercise)
        .map((flat) => answersByRef.get(flat.handle))
        .filter((answer): answer is AutoGradeAnswerView => answer !== undefined),
    [view.exercise, answersByRef],
  )

  // Count needs_review from the AUTHORITATIVE server answers, not the filtered `rows`: an
  // answer whose handle isn't matched by flattenQuestions is dropped from `rows`, and gating
  // the D9 reckoning on a row-derived count could silently suppress the band-drop warning —
  // the exact failure D9 exists to prevent. The jump target still comes from a rendered row.
  const needsReviewCount = autoGrade.answers.filter((a) => a.effectiveMark === 'needs_review').length
  const firstNeedsReviewRef = rows.find((a) => a.effectiveMark === 'needs_review')?.questionRef
  // Belt-and-suspenders: surface the reckoning whenever the server's definitive projection
  // lands below the provisional band, even if no needs_review row is visible (D3/D9 — read
  // the server signal, never a client recompute).
  const bandWillDrop = autoGrade.releasedProjection.band < autoGrade.provisionalBand
  const showReckoning = needsReviewCount > 0 || bandWillDrop

  const onOverride = useCallback(
    (questionRef: string, mark: 'correct' | 'wrong') => {
      overrideMutation.mutate(
        { questionRef, mark },
        { onError: (error) => toast.error(t(objectiveErrorKey(error))) },
      )
    },
    [overrideMutation, t],
  )

  const onConfirmRelease = useCallback(() => {
    releaseMutation.mutate(undefined, {
      onSuccess: () => {
        setConfirmOpen(false)
        toast.success(t('grading.release.success'))
        // The composite-key remount re-seeds the read-only released state from the refetch.
      },
      onError: (error) => toast.error(t(objectiveErrorKey(error))),
    })
  }, [releaseMutation, t])

  const jumpToFirstFlagged = useCallback(() => {
    if (!firstNeedsReviewRef) return
    // Target the row's stable id (not its data-testid) — getElementById handles the colon
    // handle without CSS.escape and keeps prod navigation decoupled from test hooks.
    const el = document.getElementById(objectiveRowId(firstNeedsReviewRef))
    if (el && typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center' })
    el?.focus()
  }, [firstNeedsReviewRef])

  return (
    <div className="flex flex-col gap-4 p-6" data-testid="objective-grading-page">
      <section
        aria-label={t('objectiveGrading.summary.title')}
        className="flex flex-col gap-2 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4"
      >
        {readOnly ? (
          <div
            data-testid="objective-released-badge"
            className="flex items-center gap-2 text-sm font-medium text-foreground"
          >
            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-emerald-800">
              {t('objectiveGrading.released.badge')}
            </span>
            <span>{t('objectiveGrading.released.definitiveBand', { band: formatBand(autoGrade.releasedProjection.band) })}</span>
          </div>
        ) : null}

        <div data-testid="objective-summary" className="flex flex-col gap-1">
          <span className="font-mono text-3xl leading-none text-foreground">
            {t('objectiveGrading.summary.rawScore', {
              rawScore: autoGrade.rawScore,
              maxScore: autoGrade.maxScore,
            })}
          </span>
          {!readOnly ? (
            <span className="text-sm text-muted-foreground">
              {t('objectiveGrading.summary.provisionalBand', { band: formatBand(autoGrade.provisionalBand) })}
            </span>
          ) : null}
          {!readOnly && needsReviewCount > 0 ? (
            <div className="mt-1 flex flex-col gap-1 rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
              <p>{t('objectiveGrading.summary.needsReviewNote', { count: needsReviewCount })}</p>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="self-start"
                onClick={jumpToFirstFlagged}
              >
                {t('objectiveGrading.summary.resolveNudge', { count: needsReviewCount })}
              </Button>
            </div>
          ) : null}
        </div>

        {!readOnly ? (
          <div className="flex items-baseline gap-2 text-sm">
            <span className="text-muted-foreground">{t('objectiveGrading.summary.afterOverrides')}</span>
            <span data-testid="objective-after-overrides" className="font-mono font-semibold text-foreground">
              {autoGrade.rawScore}
            </span>
            <span className="text-muted-foreground">/ {autoGrade.maxScore}</span>
          </div>
        ) : null}
      </section>

      <ol className="flex flex-col gap-3">
        {rows.map((answer) => (
          <AutoGradeAnswerRow
            key={answer.questionRef}
            answer={answer}
            readOnly={readOnly}
            disabled={locked}
            onOverride={onOverride}
          />
        ))}
      </ol>

      {!readOnly ? (
        <div className="flex justify-end">
          <Button
            data-testid="objective-release-cta"
            disabled={locked}
            onClick={() => setConfirmOpen(true)}
          >
            {t('objectiveGrading.release.cta')}
          </Button>
        </div>
      ) : null}

      <ReleaseReckoningDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        autoGrade={autoGrade}
        needsReviewCount={needsReviewCount}
        showReckoning={showReckoning}
        pending={releaseMutation.isPending || overridePending}
        onConfirm={onConfirmRelease}
      />
    </div>
  )
}

function AutoGradeAnswerRow({
  answer,
  readOnly,
  disabled,
  onOverride,
}: {
  answer: AutoGradeAnswerView
  readOnly: boolean
  disabled: boolean
  onOverride: (questionRef: string, mark: 'correct' | 'wrong') => void
}) {
  const { t } = useTranslation()
  const mark = answer.effectiveMark
  // The key is revealed only when the effective mark is wrong or needs_review (AC5 — a
  // deliberate narrowing of the epic's flat "show correct answer"; the teacher doesn't need
  // the key on a ✓ row). needs_review is a first-class resolution row (AC6).
  const revealKey = mark === 'wrong' || mark === 'needs_review'
  const overridden = answer.overrideMark != null

  return (
    <li
      id={objectiveRowId(answer.questionRef)}
      data-testid={`objective-row-${answer.questionRef}`}
      tabIndex={-1}
      className={cn(
        'flex flex-col gap-2 rounded-lg border border-border bg-card p-3',
        mark === 'needs_review' && 'border-amber-300 bg-amber-50/40',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-foreground">{answer.questionText}</p>
        <div className="flex items-center gap-2">
          {answer.studentFlagged ? (
            <span className="text-xs text-amber-700">{t('objectiveGrading.row.studentFlagged')}</span>
          ) : null}
          {overridden ? (
            <span className="rounded bg-sky-100 px-1.5 py-0.5 text-xs font-medium text-sky-800">
              {t('objectiveGrading.row.edited')}
            </span>
          ) : null}
          <MarkChip mark={mark} />
        </div>
      </div>

      <dl className="grid grid-cols-1 gap-1 text-sm sm:grid-cols-2">
        <div className="flex gap-1">
          <dt className="text-muted-foreground">{t('objectiveGrading.row.studentAnswer')}</dt>
          <dd className="text-foreground">{answer.studentAnswer}</dd>
        </div>
        {revealKey ? (
          <div className="flex gap-1">
            <dt className="text-muted-foreground">{t('objectiveGrading.row.correctAnswer')}</dt>
            <dd className="text-foreground">{answer.correctAnswer}</dd>
          </div>
        ) : null}
        {revealKey && answer.acceptedVariants.length > 0 ? (
          <div className="flex gap-1">
            <dt className="text-muted-foreground">{t('objectiveGrading.row.acceptedVariants')}</dt>
            <dd className="text-foreground">{answer.acceptedVariants.join(', ')}</dd>
          </div>
        ) : null}
      </dl>

      {!readOnly ? (
        <div className="flex gap-2">
          <Button
            type="button"
            size="sm"
            variant={mark === 'correct' ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onOverride(answer.questionRef, 'correct')}
          >
            {t('objectiveGrading.row.acceptCorrect')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant={mark === 'wrong' ? 'default' : 'outline'}
            disabled={disabled}
            onClick={() => onOverride(answer.questionRef, 'wrong')}
          >
            {t('objectiveGrading.row.markWrong')}
          </Button>
        </div>
      ) : null}
    </li>
  )
}

function MarkChip({ mark }: { mark: Mark }) {
  const { t } = useTranslation()
  const tone =
    mark === 'correct'
      ? 'bg-emerald-100 text-emerald-800'
      : mark === 'wrong'
        ? 'bg-rose-100 text-rose-800'
        : 'bg-amber-100 text-amber-800'
  return (
    <span className={cn('rounded-full px-2 py-0.5 text-xs font-semibold', tone)}>
      {t(markKey(mark))}
    </span>
  )
}

function ReleaseReckoningDialog({
  open,
  onOpenChange,
  autoGrade,
  needsReviewCount,
  showReckoning,
  pending,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  autoGrade: AutoGradeView
  needsReviewCount: number
  showReckoning: boolean
  pending: boolean
  onConfirm: () => void
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid="objective-release-dialog">
        <DialogHeader>
          <DialogTitle>{t('objectiveGrading.release.dialogTitle')}</DialogTitle>
          <DialogDescription>{t('grading.release.description')}</DialogDescription>
        </DialogHeader>
        {showReckoning ? (
          <div className="flex flex-col gap-1 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">
            {needsReviewCount > 0 ? (
              <p>{t('objectiveGrading.release.reckoning', { count: needsReviewCount })}</p>
            ) : null}
            {/* The projected released score + band come from the server field verbatim
                (D3/#1=A) — the released numbers are the last thing before the confirm
                button (D9). Show the X/max → Y/max fractions alongside the band delta so the
                teacher sees exactly what the student loses. */}
            <p data-testid="objective-release-projection" className="font-mono font-medium">
              {t('objectiveGrading.release.projection', {
                provisionalScore: autoGrade.rawScore,
                releasedScore: autoGrade.releasedProjection.rawScore,
                maxScore: autoGrade.maxScore,
                provisional: formatBand(autoGrade.provisionalBand),
                released: formatBand(autoGrade.releasedProjection.band),
              })}
            </p>
          </div>
        ) : null}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('grading.release.cancel')}
          </Button>
          <Button data-testid="objective-release-confirm" disabled={pending} onClick={onConfirm}>
            {t('grading.release.confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// --- states (mirror SpeakingGradingPage; reuse grading.* chrome copy, D6) ---

function PreparingSkeleton() {
  return (
    <div className="flex flex-col gap-4 p-6" data-testid="objective-grading-skeleton" role="status">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-72 w-full" />
    </div>
  )
}

function GradingError({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-3 p-12 text-center"
      role="alert"
      data-testid="objective-grading-error"
    >
      <p className="text-sm text-foreground">{message}</p>
      <Button size="sm" onClick={onRetry}>
        {t('grading.error.retry')}
      </Button>
    </div>
  )
}

function DesktopOnlySeam() {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-3 p-10 text-center"
      data-testid="objective-grading-desktop-seam"
      role="status"
    >
      <p className="text-sm font-medium text-foreground">{t('grading.mobileSeam.title')}</p>
      <p className="text-sm text-muted-foreground">{t('grading.mobileSeam.body')}</p>
    </div>
  )
}
