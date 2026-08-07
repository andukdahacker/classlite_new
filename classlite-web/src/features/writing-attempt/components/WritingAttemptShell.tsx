/**
 * WritingAttemptShell — Story 5.3 Tasks 4/5/6 (AC8-AC19). The distraction-free
 * writing surface. Single-tree-per-breakpoint (UX-4): desktop `WriteDocSurface`
 * (toolbar off, D1), mobile de-framed `MobileWritingSurface` + sticky word STRIP +
 * an always-reachable Submit. Composes the shared attempt spine (5.2d) around the
 * writing content shape:
 *
 *  - the ISOLATED uncontrolled editor leaf + live-text store (D5),
 *  - shared autosave (getContent reads the live-text ref) gated OFF while offline
 *    (AC12) — with the LIVE reconnect resume-flush (Winston S4),
 *  - the localStorage crash-mirror via the shared persistence hook (AC11),
 *  - the read-only clock that TICKS off the due-date so an UNTIMED attempt flips
 *    read-only at `hardDeadlineAt` mid-session (AC16, BLOCKER 3),
 *  - the shared server clock + timed-expiry auto-submit / resume-finalize (AC17),
 *  - the serialized finalizer + single-fire latch (AC15),
 *  - the per-submission BroadcastChannel submit-in-another-tab overlay (AC13).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router'
import { toast } from 'sonner'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/button'
import { WriteDocSurface } from '@/components/domain/WriteDocSurface'
import { MobileWritingSurface } from '@/components/domain/MobileWritingSurface'
import type { components } from '@/lib/api/client'
import {
  useAttemptAutosave,
  useSubmitAttempt,
  finalizeAttempt,
  useAttemptDraftPersistence,
  useAttemptTimer,
  createServerClock,
  clearStoredDraft,
  readOnlyReasonKey,
  SaveStatusIndicator,
  AttemptExpiredOverlay,
  type FinalizeLatch,
} from '@/features/attempts'
import { useAttemptStore } from '@/stores/attemptStore'
import { useWritingDraft } from '../api/useWritingDraft'
import { useOnlineStatus } from '../hooks/useOnlineStatus'
import { useAttemptBroadcast } from '../hooks/useAttemptBroadcast'
import { useWritingReadOnly } from '../hooks/useWritingReadOnly'
import {
  countWords,
  minWordsFor,
  WRITING_CONTENT_SCHEMA_VERSION,
  type WritingContent,
} from '../lib/writingContent'
import { createLiveTextStore } from '../lib/liveTextStore'
import { WritingEditorLeaf } from './WritingEditorLeaf'
import { WritingPromptBlock } from './WritingPromptBlock'
import { WordCountMeter } from './WordCountMeter'
import { TimeOnTaskMeter } from './TimeOnTaskMeter'
import { DueDateCountdown } from './DueDateCountdown'
import { WritingSubmitDialog } from './WritingSubmitDialog'
import { SubmittedElsewhereOverlay } from './SubmittedElsewhereOverlay'

type AttemptBundle = components['schemas']['AttemptBundle']

export interface WritingAttemptShellProps {
  submissionId: string
  bundle: AttemptBundle
  serverTime: string
  perfAtLoad: number
  /** The reconciled draft text (localStorage mirror ⊕ server), seeded once. */
  initialText: string
  /** Called once the attempt is finalized — the page swaps to the confirmation. */
  onSubmitted: () => void
  /** Autosave cadence override for tests (default 30s). */
  autosaveIntervalMs?: number
  /** Editor commit debounce override for tests. */
  commitDebounceMs?: number
  /** Timer/read-only tick cadence override for tests (default 1s). */
  tickMs?: number
  /** Injectable monotonic sampler for the server clock (tests; default perf.now). */
  perfNow?: () => number
}

const PENDING_STATUSES = new Set(['unsaved', 'saving', 'error', 'offline'])

export function WritingAttemptShell({
  submissionId,
  bundle,
  serverTime,
  perfAtLoad,
  initialText,
  onSubmitted,
  autosaveIntervalMs,
  commitDebounceMs,
  tickMs,
  perfNow,
}: WritingAttemptShellProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const online = useOnlineStatus()
  const { exercise, submission, assignment } = bundle

  const serverNow = useMemo(
    () => createServerClock(serverTime, perfAtLoad, perfNow),
    [serverTime, perfAtLoad, perfNow],
  )

  const { readOnly, reason, applyWriteError } = useWritingReadOnly({
    submissionStatus: submission.status,
    assignmentStatus: assignment.status,
    hardDeadlineAt: assignment.hardDeadlineAt,
    serverNow,
    tickMs,
  })

  // Multi-tab: a foreign submit makes this tab read-only + issues ZERO PUT (AC13).
  const [foreign, setForeign] = useState<{ submitted: boolean; hadUnsaved: boolean }>(
    { submitted: false, hadUnsaved: false },
  )
  const { postSubmitted } = useAttemptBroadcast(submissionId, {
    onForeignSubmit: () => {
      const status = useAttemptStore.getState().saveStatus
      // `saveStatus` lags the 600ms commit debounce, so it can still read 'saved'
      // for text typed in the last window. Also compare the LIVE store to the
      // committed draft so the orphan-warning ("your recent edits weren't
      // included") is never silently suppressed for those un-committed edits.
      const hasUncommitted = store.get() !== draft.content.text
      setForeign({
        submitted: true,
        hadUnsaved: PENDING_STATUSES.has(status) || hasUncommitted,
      })
    },
  })

  const editorReadOnly = readOnly || foreign.submitted

  // The live-text store: the isolated editor value, seeded ONCE from the
  // reconciled draft (D5). Read at save time by `getContent`. A `useState` lazy
  // initializer (not a ref read during render) keeps it stable + lint-clean.
  const [store] = useState(() => createLiveTextStore(initialText))

  const draft = useWritingDraft(submissionId)
  useAttemptDraftPersistence<WritingContent>({
    submissionId,
    content: draft.content,
    enabled: !editorReadOnly,
    onMirrorUnavailable: () => toast.warning(t('attempt.draft.localUnavailable')),
  })

  const getContent = useCallback(
    (): WritingContent => ({
      schemaVersion: WRITING_CONTENT_SCHEMA_VERSION,
      text: store.get(),
    }),
    [store],
  )

  const autosave = useAttemptAutosave<WritingContent>(submissionId, {
    getContent,
    enabled: !editorReadOnly && online,
    intervalMs: autosaveIntervalMs,
    onError: (error) => {
      const outcome = applyWriteError(error)
      if (outcome.kind === 'saveError') toast.error(t(outcome.messageKey))
    },
  })

  // Debounced commit from the leaf → cache draft (mirrored) + arm autosave. Never
  // per keystroke (AC2). Read-only/foreign short-circuit so no write is scheduled.
  const onCommit = useCallback(
    (text: string) => {
      if (editorReadOnly) return
      draft.setText(text)
      autosave.scheduleSave()
    },
    [editorReadOnly, draft, autosave],
  )

  // Offline: pause autosave (enabled=false above), surface the reassurance +
  // `offline` save status; on the online transition run the LIVE reconnect
  // resume-flush that EXPLICITLY pushes the local-newer draft up (Winston S4 — a
  // naive un-gate leaves dirty=false and nothing saves).
  const setSaveStatus = useAttemptStore((s) => s.setSaveStatus)
  const flushRef = useRef(autosave.flush)
  useEffect(() => {
    flushRef.current = autosave.flush
  })
  const wasOfflineRef = useRef(false)
  useEffect(() => {
    if (editorReadOnly) return
    if (!online) {
      wasOfflineRef.current = true
      setSaveStatus('offline')
      return
    }
    if (wasOfflineRef.current) {
      wasOfflineRef.current = false
      void flushRef.current().catch(() => {})
    }
  }, [online, editorReadOnly, setSaveStatus])

  // Finalizer (AC15) — shared latch across confirm + timed expiry.
  const submitMutation = useSubmitAttempt(submissionId)
  const latchRef = useRef<FinalizeLatch>({ current: false })
  const [finalizing, setFinalizing] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitRetry, setSubmitRetry] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSnapshot, setSubmitSnapshot] = useState({ wordCount: 0, isLate: false })

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
        postSubmitted()
        onSubmitted()
        return
      }
      // flush-failed / submit-failed → the "couldn't save everything" retry
      // fallback, never a silent lossy submit (AC15). Refresh the snapshot here:
      // the timed-expiry path (`runFinalize(true)`) never went through
      // `openSubmit`, so without this the retry dialog would show the initial
      // {wordCount: 0, isLate: false} — a false "0 words" + spurious under-length.
      setFinalizing(false)
      setSubmitSnapshot({
        wordCount: countWords(store.get()),
        isLate: Date.parse(assignment.deadlineAt) <= serverNow(),
      })
      setSubmitRetry(true)
      setSubmitOpen(true)
    },
    [
      autosave.flush,
      submitMutation,
      submissionId,
      onSubmitted,
      postSubmitted,
      store,
      assignment.deadlineAt,
      serverNow,
    ],
  )

  // Timed attempts run the shared countdown-to-expiry + auto-submit + the
  // resume-finalize-on-expired-load. Untimed (`timeBudgetSeconds === null`) →
  // null remaining, no auto-submit (AC17).
  const timer = useAttemptTimer({
    startedAt: submission.startedAt,
    timeBudgetSeconds: submission.timeBudgetSeconds,
    serverNow,
    enabled: !editorReadOnly,
    onExpire: () => {
      void runFinalize(true)
    },
  })

  const min = useMemo(() => minWordsFor(exercise), [exercise])
  const prompt = useMemo(
    () =>
      exercise.sections
        .map((section) => section.content)
        .filter((content) => content.length > 0)
        .join('\n\n'),
    [exercise],
  )

  const openSubmit = () => {
    setSubmitRetry(false)
    setSubmitSnapshot({
      wordCount: countWords(store.get()),
      isLate: Date.parse(assignment.deadlineAt) <= serverNow(),
    })
    setSubmitOpen(true)
  }

  // Read-only flip → move focus to the banner + announce (Sally S7 — the textarea
  // disabling under the cursor must not strand a keyboard/SR user). role="alert"
  // announces; the focus move is explicit.
  const bannerRef = useRef<HTMLDivElement>(null)
  const prevReadOnlyRef = useRef(readOnly)
  useEffect(() => {
    if (readOnly && !prevReadOnlyRef.current) {
      // Final flush of PRE-deadline edits before the surface locks: the student's
      // last words (typed before the hard deadline, still dirty within the
      // autosave window) must reach the server for grading — the attempt can no
      // longer be submitted once read-only. One boundary PUT only when there is
      // pending content; autosave then stays disabled (zero further PUT).
      const status = useAttemptStore.getState().saveStatus
      const hasPending =
        PENDING_STATUSES.has(status) || store.get() !== draft.content.text
      if (hasPending) void flushRef.current().catch(() => {})
      bannerRef.current?.focus()
    }
    prevReadOnlyRef.current = readOnly
  }, [readOnly, store, draft])

  const editorLeaf = (
    <>
      {prompt.length > 0 ? <WritingPromptBlock prompt={prompt} /> : null}
      <WritingEditorLeaf
        store={store}
        initialText={initialText}
        disabled={editorReadOnly}
        onCommit={onCommit}
        ariaLabel={t('writing.editor.label')}
        placeholder={t('writing.editor.placeholder')}
        debounceMs={commitDebounceMs}
      />
    </>
  )

  const wordMeter = <WordCountMeter store={store} min={min} />
  const timeMeter = (
    <TimeOnTaskMeter
      startedAt={submission.startedAt}
      serverNow={serverNow}
      tickMs={tickMs}
    />
  )
  const dueMeter = (
    <DueDateCountdown
      deadlineAt={assignment.deadlineAt}
      serverNow={serverNow}
      tickMs={tickMs}
    />
  )

  return (
    <div
      className="flex min-h-screen flex-col bg-[var(--cl-paper)]"
      data-testid="writing-attempt-shell"
    >
      {finalizing ? <AttemptExpiredOverlay /> : null}
      {foreign.submitted ? (
        <SubmittedElsewhereOverlay hadUnsavedText={foreign.hadUnsaved} />
      ) : null}

      {/* Read-only inline banner (AC16) — focusable so the flip can move focus. */}
      {readOnly && reason ? (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          data-testid="writing-readonly-banner"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)] outline-none"
        >
          {t(readOnlyReasonKey(reason))}
        </div>
      ) : null}

      {/* Offline reassurance — its OWN visible line, not a recolored pill (AC12). */}
      {!online && !editorReadOnly ? (
        <div
          role="status"
          data-testid="writing-offline-banner"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {t('writing.offline.reassurance')}
        </div>
      ) : null}

      {/* Timed attempts render the abandoned-tab note (AC17 accepted-risk). */}
      {timer.remainingSeconds !== null ? (
        <p
          className="px-4 py-1 text-xs text-[var(--cl-ink-soft)]"
          data-testid="writing-tab-only-note"
        >
          {t('attempt.timer.tabOnlyNote')}
        </p>
      ) : null}

      <div className="flex-1">
        {isDesktop ? (
          <div className="mx-auto flex max-w-3xl flex-col gap-3 px-4 py-6" data-testid="writing-desktop">
            {!editorReadOnly ? (
              // Sticky so Submit stays reachable without scrolling on desktop
              // (AC18) — the essay column auto-grows unbounded below it.
              <div className="sticky top-0 z-10 flex justify-end bg-[var(--cl-paper)] py-2">
                <Button
                  type="button"
                  onClick={openSubmit}
                  data-testid="writing-submit-open"
                >
                  {t('writing.submit.cta')}
                </Button>
              </div>
            ) : null}
            <WriteDocSurface
              title={exercise.title}
              content={editorLeaf}
              showToolbar={false}
              saveState="saved"
              saveSlot={<SaveStatusIndicator />}
              dueCountdown={dueMeter}
              wordCount={0}
              wordCountSlot={wordMeter}
              timeOnTaskSec={0}
              timeSlot={timeMeter}
            />
          </div>
        ) : (
          <div data-testid="writing-mobile">
            <MobileWritingSurface
              title={exercise.title}
              content={editorLeaf}
              showToolbar={false}
              saveState="saved"
              saveSlot={<SaveStatusIndicator />}
              dueSlot={dueMeter}
              onBack={() => navigate('/assignments')}
              stickyBarSlot={
                <>
                  {wordMeter}
                  {!editorReadOnly ? (
                    <Button
                      type="button"
                      onClick={openSubmit}
                      data-testid="writing-submit-open"
                      className="min-h-11"
                    >
                      {t('writing.submit.cta')}
                    </Button>
                  ) : null}
                </>
              }
            />
          </div>
        )}
      </div>

      <WritingSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        isDesktop={isDesktop}
        wordCount={submitSnapshot.wordCount}
        min={min}
        isLate={submitSnapshot.isLate}
        latePenalty={assignment.latePenalty}
        onConfirm={() => void runFinalize(false)}
        submitting={submitting}
        retry={submitRetry}
      />
    </div>
  )
}
