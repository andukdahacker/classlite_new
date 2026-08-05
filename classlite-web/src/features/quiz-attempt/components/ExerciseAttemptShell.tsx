/**
 * ExerciseAttemptShell — Story 5.2b Task 7 (AC2,3,7,8,9,12,16,20,21). The
 * distraction-free attempt shell. Desktop: a draggable, keyboard-operable
 * split-pane (`react-resizable-panels`) — passage/audio left, questions right.
 * Mobile (AC21): a switchable-segment tree (Passage/Audio ↔ Questions), the
 * navigator in a bottom-sheet, timer + save-status pinned. Composes the draft
 * slice, autosave, localStorage mirror, monotonic timer, and serialized
 * finalizer; derives read-only (AC15); renders the L/E/E trilogy at the page.
 */
import { useCallback, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { Group, Panel, Separator } from 'react-resizable-panels'
import { cn } from '@/lib/utils'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/button'
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from '@/components/ui/drawer'
import type { components } from '@/lib/api/client'
import { attemptKeys } from '../api/attemptKeys'
import { useAttemptAutosave } from '../api/useAttemptAutosave'
import { useAttemptDraft } from '../api/useAttemptDraft'
import { useSubmitAttempt } from '../api/useSubmitAttempt'
import { finalizeAttempt, type FinalizeLatch } from '../api/finalizeAttempt'
import { useAttemptDraftPersistence } from '../hooks/useAttemptDraftPersistence'
import { useAttemptTimer } from '../hooks/useAttemptTimer'
import {
  answeredCount,
  emptyAttemptContent,
  flaggedCount,
  flattenQuestions,
  isAnswered,
  unansweredCount,
  type AttemptContent,
} from '../lib/attemptContent'
import { createServerClock, formatRemaining } from '../lib/attemptTimer'
import {
  clearStoredDraft,
} from '../lib/attemptDraftStorage'
import {
  deriveReadOnly,
  mapWriteError,
  readOnlyReasonKey,
  type ReadOnlyReason,
} from '../lib/attemptReadOnly'
import {
  useQuizAttemptStore,
} from '@/stores/quizAttemptStore'
import { AttemptAudioPlayer } from './AttemptAudioPlayer'
import { AttemptExpiredOverlay } from './AttemptExpiredOverlay'
import { ChoiceOption } from './ChoiceOption'
import { GapInput } from './GapInput'
import { MatchingBoard, type MatchingRow } from './MatchingBoard'
import { QuestionNavigatorRail } from './QuestionNavigatorRail'
import { SaveStatusIndicator } from './SaveStatusIndicator'
import { SubmitConfirmDialog } from './SubmitConfirmDialog'
import { TimerChip } from './TimerChip'

type AttemptBundle = components['schemas']['AttemptBundle']

export interface ExerciseAttemptShellProps {
  submissionId: string
  bundle: AttemptBundle
  serverTime: string
  perfAtLoad: number
  /** Called once the attempt is finalized — the page swaps to the AC23 receipt. */
  onSubmitted: () => void
  /** Autosave cadence override for tests (default 30s). */
  autosaveIntervalMs?: number
}

export function ExerciseAttemptShell({
  submissionId,
  bundle,
  serverTime,
  perfAtLoad,
  onSubmitted,
  autosaveIntervalMs,
}: ExerciseAttemptShellProps) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const { exercise, submission, assignment } = bundle

  const serverNow = useMemo(
    () => createServerClock(serverTime, perfAtLoad),
    [serverTime, perfAtLoad],
  )

  // Read-only, derived once at load and overridable by a racing-write 409 (AC15).
  const derived = useMemo(
    () =>
      deriveReadOnly({
        submissionStatus: submission.status,
        assignmentStatus: assignment.status,
        hardDeadlineAt: assignment.hardDeadlineAt,
        serverNowMs: serverNow(),
      }),
    [submission.status, assignment.status, assignment.hardDeadlineAt, serverNow],
  )
  const [override, setOverride] = useState<ReadOnlyReason | null>(null)
  const readOnly = derived.readOnly || override !== null
  const readOnlyReason: ReadOnlyReason | null = override ?? derived.reason

  const draft = useAttemptDraft(submissionId)
  useAttemptDraftPersistence({
    submissionId,
    content: draft.content,
    enabled: !readOnly,
    onMirrorUnavailable: () => toast.warning(t('attempt.draft.localUnavailable')),
  })

  const getContent = useCallback(
    (): AttemptContent =>
      queryClient.getQueryData<AttemptContent>(attemptKeys.draft(submissionId)) ??
      emptyAttemptContent(),
    [queryClient, submissionId],
  )

  const autosave = useAttemptAutosave(submissionId, {
    getContent,
    enabled: !readOnly,
    intervalMs: autosaveIntervalMs,
    onError: (error) => {
      const outcome = mapWriteError(error)
      if (outcome.kind === 'readOnly') setOverride(outcome.reason)
      else if (outcome.kind === 'saveError') toast.error(t(outcome.messageKey))
    },
  })

  // Finalizer (AC18) — shared latch across confirm + expiry.
  const submitMutation = useSubmitAttempt(submissionId)
  const latchRef = useRef<FinalizeLatch>({ current: false })
  const [finalizing, setFinalizing] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitRetry, setSubmitRetry] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  // AC11 — the "welcome back — N left" announcement after a tab re-focus.
  const [welcomeBack, setWelcomeBack] = useState('')

  const runFinalize = useCallback(
    async (viaExpiry: boolean) => {
      if (viaExpiry) setFinalizing(true)
      setSubmitting(true)
      const result = await finalizeAttempt({
        flush: autosave.flush,
        submit: () => submitMutation.mutateAsync(),
        alreadyFinalized: latchRef.current,
      })
      setSubmitting(false)
      if (result.kind === 'submitted' || result.kind === 'noop') {
        clearStoredDraft(submissionId)
        onSubmitted()
        return
      }
      // flush-failed / submit-failed → the "couldn't save everything" retry
      // fallback, never a silent lossy submit (AC18).
      setFinalizing(false)
      setSubmitRetry(true)
      setSubmitOpen(true)
    },
    [autosave.flush, submitMutation, submissionId, onSubmitted],
  )

  const timer = useAttemptTimer({
    startedAt: submission.startedAt,
    timeBudgetSeconds: submission.timeBudgetSeconds,
    serverNow,
    enabled: !readOnly,
    onExpire: () => {
      void runFinalize(true)
    },
    onReconcile: (remaining) => {
      setWelcomeBack(
        t('attempt.timer.welcomeBack', { time: formatRemaining(remaining) }),
      )
    },
  })

  // Derived question model.
  const flat = useMemo(() => flattenQuestions(exercise), [exercise])
  const numberOf = useMemo(() => {
    const map = new Map<string, number>()
    flat.forEach((f, i) => map.set(f.handle, i + 1))
    return map
  }, [flat])
  const answeredSet = useMemo(
    () =>
      new Set(
        flat
          .filter((f) => isAnswered(draft.content.answers[f.handle]))
          .map((f) => f.handle),
      ),
    [flat, draft.content],
  )
  const flaggedSet = useMemo(() => new Set(draft.content.flagged), [draft.content])
  const navItems = useMemo(
    () => flat.map((f) => ({ handle: f.handle, number: numberOf.get(f.handle)! })),
    [flat, numberOf],
  )

  const currentIndex = useQuizAttemptStore((s) => s.currentQuestionIndex)
  const setCurrentIndex = useQuizAttemptStore((s) => s.setCurrentQuestionIndex)
  const currentHandle = flat[currentIndex]?.handle ?? null

  // Mount ONLY the breakpoint's tree (UX-4) — never both — so question ids /
  // `data-testid`s / the `<audio>` element are never duplicated and
  // `focusQuestion` targets the visible pane (AC7/AC21).
  const isDesktop = useIsDesktop()

  const focusQuestion = useCallback(
    (handle: string) => {
      const idx = flat.findIndex((f) => f.handle === handle)
      if (idx >= 0) setCurrentIndex(idx)
      const wrap = document.getElementById(`qwrap-${handle}`)
      wrap?.scrollIntoView?.({ block: 'center' })
      const focusable = wrap?.querySelector<HTMLElement>(
        'input, select, textarea, button, [role="radio"], [tabindex]',
      )
      focusable?.focus()
    },
    [flat, setCurrentIndex],
  )

  const goPrev = () => {
    if (currentIndex > 0) focusQuestion(flat[currentIndex - 1].handle)
  }
  const goNext = () => {
    if (currentIndex < flat.length - 1) focusQuestion(flat[currentIndex + 1].handle)
  }

  const onAnswer = useCallback(
    (handle: string, value: string) => {
      if (readOnly) return
      draft.setAnswer(handle, value)
      autosave.scheduleSave()
    },
    [readOnly, draft, autosave],
  )
  const onToggleFlag = useCallback(
    (handle: string) => {
      if (readOnly) return
      draft.toggleFlag(handle)
      autosave.scheduleSave()
    },
    [readOnly, draft, autosave],
  )

  const counts = {
    answered: answeredCount(draft.content, exercise),
    unanswered: unansweredCount(draft.content, exercise),
    flagged: flaggedCount(draft.content, exercise),
  }

  const jumpFirstUnanswered = () => {
    const target = flat.find((f) => !isAnswered(draft.content.answers[f.handle]))
    if (target) {
      setSubmitOpen(false)
      focusQuestion(target.handle)
    }
  }
  const jumpFirstFlagged = () => {
    const target = flat.find((f) => flaggedSet.has(f.handle))
    if (target) {
      setSubmitOpen(false)
      focusQuestion(target.handle)
    }
  }

  // ---- render helpers ----
  const leftPane = (
    <div className="flex flex-col gap-6 p-4" data-testid="attempt-left-pane">
      {exercise.sections.map((section, si) => (
        <section key={si} className="flex flex-col gap-2">
          {section.title ? (
            <h2 className="font-[var(--cl-font-display)] text-lg text-[var(--cl-ink)]">
              {section.title}
            </h2>
          ) : null}
          {section.type === 'listening' ? (
            <AttemptAudioPlayer content={section.content} />
          ) : (
            <div className="whitespace-pre-wrap text-[var(--cl-ink)]">
              {section.content}
            </div>
          )}
        </section>
      ))}
    </div>
  )

  const questionsPane = (
    <div
      className="flex flex-col gap-6 p-4"
      data-testid="attempt-questions-pane"
    >
      {exercise.sections.map((section, si) =>
        section.questionGroups.map((group, gi) => {
          if (group.type === 'matching') {
            const rows: MatchingRow[] = group.questions.map((question, qi) => {
              const handle = `${si}:${gi}:${qi}`
              return { handle, questionNumber: numberOf.get(handle)!, question }
            })
            const values: Record<string, string> = {}
            for (const row of rows) values[row.handle] = draft.content.answers[row.handle] ?? ''
            return (
              // No group-level qwrap — each MatchingRowField owns its own
              // `qwrap-<handle>` so the navigator can reach every row (not just
              // the first) and each row is independently flaggable.
              <div key={`${si}:${gi}`} className="flex flex-col gap-2">
                <MatchingBoard
                  rows={rows}
                  values={values}
                  onChange={onAnswer}
                  disabled={readOnly}
                  currentHandle={currentHandle}
                  flagged={flaggedSet}
                  onToggleFlag={onToggleFlag}
                />
              </div>
            )
          }
          return group.questions.map((question, qi) => {
            const handle = `${si}:${gi}:${qi}`
            const number = numberOf.get(handle)!
            const value = draft.content.answers[handle] ?? ''
            const isChoice =
              group.type === 'true_false_not_given' ||
              group.type === 'multiple_choice'
            return (
              <div
                key={handle}
                id={`qwrap-${handle}`}
                className={cn(
                  'flex flex-col gap-2 rounded-[var(--cl-radius-md)] border p-3',
                  handle === currentHandle
                    ? 'border-[var(--cl-accent)]'
                    : 'border-[var(--cl-line)]',
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    {isChoice ? (
                      <ChoiceOption
                        handle={handle}
                        questionNumber={number}
                        question={question}
                        groupType={
                          group.type as 'true_false_not_given' | 'multiple_choice'
                        }
                        value={value}
                        onChange={(v: string) => onAnswer(handle, v)}
                        disabled={readOnly}
                      />
                    ) : (
                      <GapInput
                        handle={handle}
                        questionNumber={number}
                        question={question}
                        value={value}
                        onChange={(v: string) => onAnswer(handle, v)}
                        disabled={readOnly}
                      />
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onToggleFlag(handle)}
                    disabled={readOnly}
                    aria-pressed={flaggedSet.has(handle)}
                    aria-label={t('attempt.flag.toggle', { number })}
                    data-testid={`flag-${handle}`}
                    className={cn(
                      'flex size-11 shrink-0 items-center justify-center rounded-[var(--cl-radius-sm)] text-lg',
                      flaggedSet.has(handle)
                        ? 'text-[var(--cl-amber)]'
                        : 'text-[var(--cl-ink-soft)]',
                    )}
                  >
                    ⚑
                  </button>
                </div>
              </div>
            )
          })
        }),
      )}
    </div>
  )

  const prevNext = (
    <div className="flex items-center justify-between gap-2 p-3">
      <Button
        type="button"
        variant="outline"
        onClick={goPrev}
        disabled={currentIndex <= 0}
        data-testid="attempt-prev"
        className="min-h-11" // AC21 — ≥44px touch target
      >
        {t('attempt.nav.prev')}
      </Button>
      <Button
        type="button"
        variant="outline"
        onClick={goNext}
        disabled={currentIndex >= flat.length - 1}
        data-testid="attempt-next"
        className="min-h-11" // AC21 — ≥44px touch target
      >
        {t('attempt.nav.next')}
      </Button>
    </div>
  )

  const navigator = (
    <QuestionNavigatorRail
      items={navItems}
      answered={answeredSet}
      flagged={flaggedSet}
      currentHandle={currentHandle}
      onJump={focusQuestion}
    />
  )

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--cl-paper)]"
      data-testid="attempt-shell"
    >
      {finalizing ? <AttemptExpiredOverlay /> : null}

      {/* Pinned header: timer + save-status + submit (AC12/AC20). */}
      <header className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-[var(--cl-line)] bg-[var(--cl-surface)] px-4 py-2">
        <div className="flex items-center gap-3">
          <TimerChip
            remainingSeconds={timer.remainingSeconds}
            warningLevel={timer.warningLevel}
          />
          <SaveStatusIndicator />
        </div>
        {!readOnly ? (
          <Button
            type="button"
            onClick={() => {
              setSubmitRetry(false)
              setSubmitOpen(true)
            }}
            data-testid="attempt-submit-open"
          >
            {t('attempt.submit.cta')}
          </Button>
        ) : null}
      </header>

      {/* AC11 — "welcome back — N left" after a tab re-focus (shown + announced,
          never a silent jump). Cleared when the student interacts is fine — it's
          a transient status line. */}
      {welcomeBack ? (
        <p
          role="status"
          aria-live="polite"
          data-testid="attempt-welcome-back"
          className="border-b border-[var(--cl-line)] bg-[var(--cl-surface)] px-4 py-1 text-xs text-[var(--cl-ink-soft)]"
        >
          {welcomeBack}
        </p>
      ) : null}

      {/* Read-only inline banner (AC15) — not only a toast. */}
      {readOnly && readOnlyReason ? (
        <div
          role="alert"
          data-testid="attempt-readonly-banner"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {t(readOnlyReasonKey(readOnlyReason))}
        </div>
      ) : null}

      {/* Timed attempts render the abandoned-tab note (AC19 accepted-risk). */}
      {timer.remainingSeconds !== null ? (
        <p
          className="px-4 py-1 text-xs text-[var(--cl-ink-soft)]"
          data-testid="attempt-tab-only-note"
        >
          {t('attempt.timer.tabOnlyNote')}
        </p>
      ) : null}

      {isDesktop ? (
        /* Desktop: draggable split-pane (AC2). Only this tree mounts at md+. */
        <div className="flex-1" data-testid="attempt-desktop">
          <Group orientation="horizontal" className="h-full">
            <Panel defaultSize="45" minSize="25" className="overflow-auto">
              {leftPane}
            </Panel>
            <Separator
              aria-label={t('attempt.passage.label')}
              className="w-1.5 cursor-col-resize bg-[var(--cl-line)] hover:bg-[var(--cl-accent)]"
            />
            <Panel defaultSize="55" minSize="30" className="flex flex-col overflow-auto">
              <div className="border-b border-[var(--cl-line)] p-3">{navigator}</div>
              <div className="flex-1">{questionsPane}</div>
              {!readOnly ? prevNext : null}
            </Panel>
          </Group>
        </div>
      ) : (
        /* Mobile: switchable-segment tree + bottom-sheet navigator (AC21). */
        <MobileTree
          leftPane={leftPane}
          questionsPane={questionsPane}
          navigator={navigator}
          prevNext={!readOnly ? prevNext : null}
          hasAudio={exercise.sections.some((s) => s.type === 'listening')}
          current={currentIndex + 1}
          total={flat.length}
        />
      )}

      <SubmitConfirmDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        answered={counts.answered}
        unanswered={counts.unanswered}
        flagged={counts.flagged}
        onJumpUnanswered={jumpFirstUnanswered}
        onJumpFlagged={jumpFirstFlagged}
        onConfirm={() => void runFinalize(false)}
        submitting={submitting}
        retry={submitRetry}
      />
    </div>
  )
}

interface MobileTreeProps {
  leftPane: React.ReactNode
  questionsPane: React.ReactNode
  navigator: React.ReactNode
  prevNext: React.ReactNode
  hasAudio: boolean
  current: number
  total: number
}

function MobileTree({
  leftPane,
  questionsPane,
  navigator,
  prevNext,
  hasAudio,
  current,
  total,
}: MobileTreeProps) {
  const { t } = useTranslation()
  const [segment, setSegment] = useState<'passage' | 'questions'>('questions')

  return (
    <div className="flex flex-1 flex-col" data-testid="attempt-mobile">
      <div
        role="tablist"
        aria-label={t('attempt.nav.title')}
        className="flex border-b border-[var(--cl-line)]"
      >
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'passage'}
          onClick={() => setSegment('passage')}
          data-testid="mobile-segment-passage"
          className={cn(
            'flex-1 min-h-11 py-2 text-sm font-medium', // AC21 — ≥44px touch target
            segment === 'passage'
              ? 'border-b-2 border-[var(--cl-accent)] text-[var(--cl-ink)]'
              : 'text-[var(--cl-ink-soft)]',
          )}
        >
          {hasAudio ? t('attempt.segment.audio') : t('attempt.segment.passage')}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={segment === 'questions'}
          onClick={() => setSegment('questions')}
          data-testid="mobile-segment-questions"
          className={cn(
            'flex-1 min-h-11 py-2 text-sm font-medium', // AC21 — ≥44px touch target
            segment === 'questions'
              ? 'border-b-2 border-[var(--cl-accent)] text-[var(--cl-ink)]'
              : 'text-[var(--cl-ink-soft)]',
          )}
        >
          {t('attempt.segment.questions')}
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        {segment === 'passage' ? leftPane : questionsPane}
      </div>

      <div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-[var(--cl-line)] bg-[var(--cl-surface)] p-2">
        {prevNext}
        <Drawer>
          <DrawerTrigger
            data-testid="mobile-navigator-trigger"
            className="inline-flex min-h-11 items-center rounded-[var(--cl-radius-full)] bg-[var(--cl-ink)] px-3 text-sm text-[var(--cl-surface)]"
          >
            {t('attempt.nav.openGrid', { current, total })}
          </DrawerTrigger>
          <DrawerContent data-testid="mobile-navigator-sheet">
            <DrawerHeader>
              <DrawerTitle>{t('attempt.nav.title')}</DrawerTitle>
            </DrawerHeader>
            <div className="p-4">{navigator}</div>
          </DrawerContent>
        </Drawer>
      </div>
    </div>
  )
}
