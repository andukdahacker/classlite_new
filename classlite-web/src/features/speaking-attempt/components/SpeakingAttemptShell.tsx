/**
 * SpeakingAttemptShell — Story 5.4 Task 7 (AC15,17,18,19,20,21). The speaking
 * surface. Single-tree-per-breakpoint (UX-4): thumb-first mobile, record + Submit
 * both always-reachable. Composes the shared attempt spine (5.2d) around the
 * SERVER-MINTED-KEY value semantics (the source of the party-mode BLOCKERs):
 *
 *  - the ISOLATED recorder leaf (AC2) reports the settled take up here,
 *  - the SUBMIT contract (Winston B1): a synchronous re-entrancy ref-guard →
 *    `await ensureLatestTakeUploaded()` (presign→PUT→confirm → write the key into
 *    the draft) → the shared `finalizeAttempt` (upload-agnostic; flush → submit),
 *  - offline record-now-upload-later (AC15): held Blob armed with a `beforeunload`
 *    guard + honest reassurance; reconnect auto-uploads, READ-ONLY-GATED so a
 *    deadline that passed offline strands the Blob (warned, never orphan-uploaded),
 *  - the ticking read-only clock (untimed hard-deadline flip) + Blob-aware
 *    flush-on-flip (AC19): pending key → ONE final PUT; pending Blob-no-key → warn,
 *  - the shared server clock + timed-expiry auto-submit / resume-finalize (AC20),
 *  - the per-submission BroadcastChannel submit-in-another-tab overlay (AC17).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useBlocker } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  attemptKeys,
  SaveStatusIndicator,
  AttemptExpiredOverlay,
  useOnlineStatus,
  useAttemptBroadcast,
  useAttemptReadOnly,
  type FinalizeLatch,
} from '@/features/attempts'
import { useAttemptStore } from '@/stores/attemptStore'
import { useSpeakingDraft } from '../api/useSpeakingDraft'
import { useSpeakingUpload } from '../hooks/useSpeakingUpload'
import { useBeforeUnloadGuard } from '../hooks/useBeforeUnloadGuard'
import type { RecordedTake } from '../hooks/useMediaRecorder'
import { emptySpeakingContent, type SpeakingContent } from '../lib/speakingContent'
import { SpeakingRecorderLeaf } from './SpeakingRecorderLeaf'
import { SpeakingSubmitDialog } from './SpeakingSubmitDialog'
import { SubmittedElsewhereOverlay } from './SubmittedElsewhereOverlay'

type AttemptBundle = components['schemas']['AttemptBundle']

export interface SpeakingAttemptShellProps {
  submissionId: string
  bundle: AttemptBundle
  serverTime: string
  perfAtLoad: number
  /** Called once the attempt is finalized — the page swaps to the confirmation. */
  onSubmitted: () => void
  /** Autosave cadence override for tests (default 30s). */
  autosaveIntervalMs?: number
  /** Timer/read-only tick cadence override for tests (default 1s). */
  tickMs?: number
  /** Injectable monotonic sampler for the server clock (tests; default perf.now). */
  perfNow?: () => number
  /** Recorder test injectables (threaded into the leaf). */
  prepSeconds?: number
  maxDurationSec?: number
  recorderNow?: () => number
  isTypeSupported?: (mimeType: string) => boolean
}

const PENDING_STATUSES = new Set(['unsaved', 'saving', 'error', 'offline'])

export function SpeakingAttemptShell({
  submissionId,
  bundle,
  serverTime,
  perfAtLoad,
  onSubmitted,
  autosaveIntervalMs,
  tickMs,
  perfNow,
  prepSeconds,
  maxDurationSec,
  recorderNow,
  isTypeSupported,
}: SpeakingAttemptShellProps) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  const online = useOnlineStatus()
  const queryClient = useQueryClient()
  const { exercise, submission, assignment } = bundle

  const serverNow = useMemo(
    () => createServerClock(serverTime, perfAtLoad, perfNow),
    [serverTime, perfAtLoad, perfNow],
  )

  const { readOnly, reason, applyWriteError } = useAttemptReadOnly({
    submissionStatus: submission.status,
    assignmentStatus: assignment.status,
    hardDeadlineAt: assignment.hardDeadlineAt,
    serverNow,
    tickMs,
  })

  const draft = useSpeakingDraft(submissionId)
  const upload = useSpeakingUpload()

  // The latest recorded take from the leaf + which take's key is already in the
  // draft (uploaded). heldBlob = a recorded take whose key has NOT been persisted.
  // `uploadedObjectUrl` is STATE (read in render for heldBlob); the ref mirror is
  // for the "latest committed" reads inside effects/callbacks.
  const [take, setTake] = useState<RecordedTake | null>(null)
  const [uploadedObjectUrl, setUploadedObjectUrl] = useState<string | null>(null)
  const takeRef = useRef<RecordedTake | null>(null)
  const uploadedObjectUrlRef = useRef<string | null>(null)
  // Guards against two upload paths (reconnect / manual retry / submit) racing on
  // the SAME take between one resolving and its `uploadedObjectUrl` mirror syncing —
  // which would presign a second key and orphan the first (SEC-8 / FU-4-4-6).
  const uploadInFlightRef = useRef(false)
  useEffect(() => {
    takeRef.current = take
  }, [take])
  useEffect(() => {
    uploadedObjectUrlRef.current = uploadedObjectUrl
  }, [uploadedObjectUrl])
  const heldBlob = take !== null && take.objectUrl !== uploadedObjectUrl

  // Multi-tab: a foreign submit makes this tab read-only + issues ZERO PUT (AC17).
  const [foreign, setForeign] = useState<{ submitted: boolean; hadUnsaved: boolean }>({
    submitted: false,
    hadUnsaved: false,
  })
  const { postSubmitted } = useAttemptBroadcast(submissionId, {
    onForeignSubmit: () => {
      const held = takeRef.current !== null && takeRef.current.objectUrl !== uploadedObjectUrlRef.current
      const status = useAttemptStore.getState().saveStatus
      setForeign({ submitted: true, hadUnsaved: held || PENDING_STATUSES.has(status) })
    },
  })

  const editorReadOnly = readOnly || foreign.submitted

  // A held (un-uploaded) take under a read-only / foreign flip can never be
  // uploaded (the reconnect/flush paths are read-only-gated) — it is stranded. This
  // is DERIVED, not effect-set, so it covers both a take held BEFORE the flip and a
  // take that settles AFTER the flip (the leaf stops the recorder mid-record) with
  // no orphan-upload (AC15/AC19).
  const strandedTake = editorReadOnly && heldBlob

  useAttemptDraftPersistence<SpeakingContent>({
    submissionId,
    content: draft.content,
    enabled: !editorReadOnly,
    onMirrorUnavailable: () => toast.warning(t('attempt.draft.localUnavailable')),
  })

  // getContent reads the LIVE draft cache (never the render-lagged `draft.content`)
  // so a key written synchronously before flush is picked up (AC14).
  const getContent = useCallback(
    (): SpeakingContent =>
      queryClient.getQueryData<SpeakingContent>(attemptKeys.draft(submissionId)) ??
      emptySpeakingContent(),
    [queryClient, submissionId],
  )

  const autosave = useAttemptAutosave<SpeakingContent>(submissionId, {
    getContent,
    enabled: !editorReadOnly && online,
    intervalMs: autosaveIntervalMs,
    onError: (error) => {
      const outcome = applyWriteError(error)
      if (outcome.kind === 'saveError') toast.error(t(outcome.messageKey))
    },
  })

  const setSaveStatus = useAttemptStore((s) => s.setSaveStatus)
  const flushRef = useRef(autosave.flush)
  useEffect(() => {
    flushRef.current = autosave.flush
  })

  // Persist a just-uploaded take's key into the draft cache + mirror. Does NOT
  // flush: the submit path flushes once inside `finalizeAttempt` (so exactly ONE
  // /progress PUT carries the key — E2E-J7-001), while the background/reconnect
  // path flushes explicitly afterward for the discrete save-on-upload-success
  // (AC14).
  const persistUploadedKey = useCallback(
    (uploadedTake: RecordedTake, key: string) => {
      draft.setAudio(key, uploadedTake.contentType, uploadedTake.durationSec)
      // Update the ref SYNCHRONOUSLY (not just via the state→effect mirror) so a
      // path that reads `uploadedObjectUrlRef` in the same tick a background upload
      // resolved already sees the just-uploaded take and does NOT re-upload it.
      uploadedObjectUrlRef.current = uploadedTake.objectUrl
      setUploadedObjectUrl(uploadedTake.objectUrl)
    },
    [draft],
  )

  // Arm the beforeunload guard whenever an un-uploaded in-memory take is held (D2 —
  // a reload would lose it; IndexedDB durability is FU-5-4-B). Not once stranded:
  // the take can no longer be saved, so nagging on leave is a dead-end.
  useBeforeUnloadGuard(heldBlob && !foreign.submitted && !strandedTake)

  // beforeunload only catches a full-page unload; an in-app SPA nav (the mobile
  // Back button, a browser back, any route change) would silently drop the
  // local-only take. Block it and confirm (AC15 — parity with the unload guard).
  const blocker = useBlocker(
    useCallback(
      ({ currentLocation, nextLocation }) =>
        heldBlob &&
        !foreign.submitted &&
        !strandedTake &&
        currentLocation.pathname !== nextLocation.pathname,
      [heldBlob, foreign.submitted, strandedTake],
    ),
  )

  const wasOfflineRef = useRef(false)
  useEffect(() => {
    if (!online) {
      wasOfflineRef.current = true
      if (!editorReadOnly) setSaveStatus('offline')
      return
    }
    if (!wasOfflineRef.current) return
    wasOfflineRef.current = false
    if (editorReadOnly) return // read-only-gated: never presign/PUT after the flip
    const current = takeRef.current
    if (current && current.objectUrl !== uploadedObjectUrlRef.current) {
      if (uploadInFlightRef.current) return // a submit/retry upload is already running
      uploadInFlightRef.current = true
      void (async () => {
        try {
          const key = await upload.upload(current).catch(() => null)
          if (key !== null) {
            persistUploadedKey(current, key)
            void flushRef.current().catch(() => {}) // discrete save-on-upload-success (AC14)
          }
        } finally {
          uploadInFlightRef.current = false
        }
      })()
    } else {
      // A previously-uploaded key whose /progress PUT hadn't landed → flush now.
      const status = useAttemptStore.getState().saveStatus
      if (getContent().audioKey !== '' && PENDING_STATUSES.has(status)) {
        void flushRef.current().catch(() => {})
      }
    }
  }, [online, editorReadOnly, setSaveStatus, upload, persistUploadedKey, getContent])

  // Manual retry for a background/reconnect upload that exhausted its auto-retries
  // (upload.status === 'failed'). Re-runs the held take through presign→PUT→confirm
  // and, on success, flushes the key (AC13/AC15 — otherwise the failure is silent).
  const retryUpload = useCallback(() => {
    if (editorReadOnly) return // read-only-gated, parity with reconnect/ensureLatest (AC15/19)
    const current = takeRef.current
    if (current === null || current.objectUrl === uploadedObjectUrlRef.current) return
    if (uploadInFlightRef.current) return
    uploadInFlightRef.current = true
    void (async () => {
      try {
        const key = await upload.upload(current).catch(() => null)
        if (key !== null) {
          persistUploadedKey(current, key)
          void flushRef.current().catch(() => {})
        }
      } finally {
        uploadInFlightRef.current = false
      }
    })()
  }, [upload, persistUploadedKey, editorReadOnly])

  // Finalizer (AC18/AC20) — shared latch across confirm + timed expiry, PLUS a
  // synchronous re-entrancy ref-guard around the WHOLE upload+finalize window.
  const submitMutation = useSubmitAttempt(submissionId)
  const latchRef = useRef<FinalizeLatch>({ current: false })
  const submitInFlightRef = useRef(false)
  const [finalizing, setFinalizing] = useState(false)
  const [submitOpen, setSubmitOpen] = useState(false)
  const [submitRetry, setSubmitRetry] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [submitSnapshot, setSubmitSnapshot] = useState({ isLate: false })

  // Upload the latest take if its key isn't in the draft yet (AC18). Throws on a
  // failed upload so the caller surfaces the retry dialog (never a silent lossy
  // keyless submit when the student DID record).
  const ensureLatestTakeUploaded = useCallback(async () => {
    const current = takeRef.current
    if (current === null) return // keyless no-recording path submits cleanly
    if (current.objectUrl === uploadedObjectUrlRef.current) return // already uploaded
    // Mark in-flight so a racing reconnect/manual-retry upload of the same take skips
    // (this submit path is authoritative — it must land the key it finalizes with).
    uploadInFlightRef.current = true
    try {
      const key = await upload.upload(current)
      if (key === null) throw new Error('speaking-upload-failed')
      persistUploadedKey(current, key)
    } finally {
      uploadInFlightRef.current = false
    }
  }, [upload, persistUploadedKey])

  const openRetryDialog = useCallback(() => {
    setFinalizing(false)
    setSubmitSnapshot({ isLate: Date.parse(assignment.deadlineAt) <= serverNow() })
    setSubmitRetry(true)
    setSubmitOpen(true)
  }, [assignment.deadlineAt, serverNow])

  const runFinalize = useCallback(
    async (viaExpiry: boolean) => {
      if (submitInFlightRef.current) return // synchronous guard over the upload window
      submitInFlightRef.current = true
      if (viaExpiry) setFinalizing(true)
      setSubmitting(true)
      try {
        await ensureLatestTakeUploaded()
      } catch {
        setSubmitting(false)
        submitInFlightRef.current = false
        openRetryDialog()
        return
      }
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
      submitInFlightRef.current = false
      openRetryDialog()
    },
    [
      ensureLatestTakeUploaded,
      autosave.flush,
      submitMutation,
      submissionId,
      onSubmitted,
      postSubmitted,
      openRetryDialog,
    ],
  )

  // Escape hatch (AC20) — when a timed attempt expired (or a submit) with a take
  // whose upload keeps failing, `ensureLatestTakeUploaded` would loop the retry
  // dialog forever. This finalizes KEYLESS (abandons the un-uploadable take) so the
  // attempt is never stuck `in_progress` past its deadline. The un-persisted key is
  // never written, so the flush + submit carry no audioKey.
  const submitWithoutAudio = useCallback(async () => {
    if (submitInFlightRef.current) return
    submitInFlightRef.current = true
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
    submitInFlightRef.current = false
    openRetryDialog()
  }, [autosave.flush, submitMutation, submissionId, onSubmitted, postSubmitted, openRetryDialog])

  const timer = useAttemptTimer({
    startedAt: submission.startedAt,
    timeBudgetSeconds: submission.timeBudgetSeconds,
    serverNow,
    enabled: !editorReadOnly,
    onExpire: () => {
      void runFinalize(true)
    },
  })

  const prompt = useMemo(
    () =>
      exercise.sections
        .map((section) => section.content)
        .filter((content) => content.length > 0)
        .join('\n\n'),
    [exercise],
  )

  const hasRecording = take !== null || draft.content.audioKey !== ''
  const durationSec = take?.durationSec ?? draft.content.durationSec

  const openSubmit = () => {
    setSubmitRetry(false)
    setSubmitSnapshot({ isLate: Date.parse(assignment.deadlineAt) <= serverNow() })
    setSubmitOpen(true)
  }

  // Read-only flip → Blob-aware flush-on-flip (AC19) + focus move + announce.
  const bannerRef = useRef<HTMLDivElement>(null)
  const prevReadOnlyRef = useRef(readOnly)
  useEffect(() => {
    if (readOnly && !prevReadOnlyRef.current) {
      const current = takeRef.current
      const held = current !== null && current.objectUrl !== uploadedObjectUrlRef.current
      // A pending Blob with NO key yet cannot be salvaged: do NOT orphan-upload
      // after the flip — it surfaces as the derived `strandedTake` warning instead.
      // A pending uploaded key awaiting its /progress PUT → ONE final flush.
      if (!held) {
        const status = useAttemptStore.getState().saveStatus
        if (getContent().audioKey !== '' && PENDING_STATUSES.has(status)) {
          void flushRef.current().catch(() => {})
        }
      }
      bannerRef.current?.focus()
    }
    prevReadOnlyRef.current = readOnly
  }, [readOnly, getContent])

  const recorder = (
    <SpeakingRecorderLeaf
      prompt={prompt}
      disabled={editorReadOnly}
      onTakeChange={setTake}
      prepSeconds={prepSeconds}
      maxDurationSec={maxDurationSec}
      now={recorderNow}
      isTypeSupported={isTypeSupported}
    />
  )

  const submitButton = !editorReadOnly ? (
    <Button type="button" onClick={openSubmit} data-testid="speaking-submit-open" className="min-h-12 text-base">
      {t('speaking.submit.cta')}
    </Button>
  ) : null

  return (
    <div className="flex min-h-screen flex-col bg-[var(--cl-paper)]" data-testid="speaking-attempt-shell">
      {finalizing ? <AttemptExpiredOverlay /> : null}
      {foreign.submitted ? (
        // `foreign.hadUnsaved` snapshots the state at the foreign-submit instant, but
        // a take that was still RECORDING then (takeRef null) settles right after the
        // leaf stops it — OR-in live `heldBlob` so that just-captured, now-stranded
        // take is still reported as "not included" (AC17), never silently dropped.
        <SubmittedElsewhereOverlay hadUnsavedRecording={foreign.hadUnsaved || heldBlob} />
      ) : null}

      {/* Background content — made `inert` while the foreign-submit overlay is up so
          keyboard/AT focus can't reach the recorder/back controls behind it, not
          just visually (AC17 — "the recorder is unreachable"). `display:contents`
          keeps the flex layout intact. */}
      <div
        className="contents"
        inert={foreign.submitted ? true : undefined}
        data-testid="speaking-shell-content"
      >
      {readOnly && reason ? (
        <div
          ref={bannerRef}
          tabIndex={-1}
          role="alert"
          data-testid="speaking-readonly-banner"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)] outline-none"
        >
          {t(readOnlyReasonKey(reason))}
        </div>
      ) : null}

      {strandedTake ? (
        <div
          role="alert"
          data-testid="speaking-stranded-offline"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {/* The flip can happen online too (assignment closed / online hard-deadline
              tick / foreign submit) — only claim "while you were offline" when we
              actually were offline; otherwise a neutral deadline-passed message. */}
          {t(online ? 'speaking.stranded.deadlinePassed' : 'speaking.offline.deadlinePassed')}
        </div>
      ) : null}

      {!online && !editorReadOnly ? (
        <div
          role="status"
          data-testid="speaking-offline-banner"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {t('speaking.offline.reassurance')}
        </div>
      ) : null}

      {upload.status === 'too-large' && !editorReadOnly ? (
        <div
          role="alert"
          data-testid="speaking-upload-too-large"
          className="border-b border-[var(--cl-red)] bg-[var(--cl-tint-red)] px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {t('speaking.upload.tooLarge')}
        </div>
      ) : null}

      {upload.status === 'retrying' ? (
        <div
          role="status"
          data-testid="speaking-upload-retrying"
          className="border-b border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          {t('speaking.upload.retrying')}
        </div>
      ) : null}

      {upload.status === 'failed' && heldBlob && !editorReadOnly ? (
        <div
          role="alert"
          data-testid="speaking-upload-failed"
          className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--cl-red)] bg-[var(--cl-tint-red)] px-4 py-2 text-sm text-[var(--cl-ink)]"
        >
          <span>{t('speaking.upload.failed')}</span>
          <button
            type="button"
            onClick={retryUpload}
            data-testid="speaking-upload-retry"
            className="min-h-11 rounded-md border border-[var(--cl-red)] px-3 text-base font-medium text-[color:var(--cl-red)] hover:bg-[var(--cl-paper)]"
          >
            {t('speaking.upload.retryAction')}
          </button>
        </div>
      ) : null}

      {timer.remainingSeconds !== null ? (
        <p className="px-4 py-1 text-xs text-[var(--cl-ink-soft)]" data-testid="speaking-tab-only-note">
          {t('attempt.timer.tabOnlyNote')}
        </p>
      ) : null}

      {isDesktop ? (
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-4 py-6" data-testid="speaking-desktop">
          <div className="flex items-center justify-between">
            <h1 className="text-lg font-semibold text-[var(--cl-ink)]">{exercise.title}</h1>
            <div className="flex items-center gap-3">
              <SaveStatusIndicator />
              {submitButton}
            </div>
          </div>
          {recorder}
        </div>
      ) : (
        <div className="flex flex-1 flex-col" data-testid="speaking-mobile">
          <div className="flex items-center justify-between border-b border-[var(--cl-line-soft)] px-4 py-3">
            <button
              type="button"
              onClick={() => navigate('/assignments')}
              className="min-h-12 min-w-12 text-base text-[var(--cl-ink-soft)]"
              data-testid="speaking-back"
            >
              {t('speaking.back')}
            </button>
            <SaveStatusIndicator />
          </div>
          <div className="flex-1 px-4 py-4">{recorder}</div>
          {submitButton ? (
            <div className="sticky bottom-0 border-t border-[var(--cl-line-soft)] bg-[var(--cl-paper)] p-4">
              {submitButton}
            </div>
          ) : null}
        </div>
      )}
      </div>

      <SpeakingSubmitDialog
        open={submitOpen}
        onOpenChange={setSubmitOpen}
        isDesktop={isDesktop}
        hasRecording={hasRecording}
        durationSec={durationSec}
        isLate={submitSnapshot.isLate}
        latePenalty={assignment.latePenalty}
        onConfirm={() => void runFinalize(false)}
        onSubmitWithoutAudio={
          // Only offer the keyless escape when the take is genuinely un-persisted
          // (upload still failing). If the key already landed and only the finalize
          // failed, "submit without audio" would mislabel a with-audio submit.
          submitRetry && heldBlob ? () => void submitWithoutAudio() : undefined
        }
        submitting={submitting}
        retry={submitRetry}
      />

      {/* In-app-nav confirm (AC15) — beforeunload can't catch an SPA route change. */}
      <AlertDialog
        open={blocker.state === 'blocked'}
        onOpenChange={(next) => {
          if (!next && blocker.state === 'blocked') blocker.reset()
        }}
      >
        <AlertDialogContent data-testid="speaking-leave-confirm">
          <AlertDialogHeader>
            <AlertDialogTitle>{t('speaking.nav.leaveTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('speaking.nav.leaveBody')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              onClick={() => {
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              {t('speaking.nav.leaveStay')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="speaking-leave-confirm-action"
              onClick={() => {
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              {t('speaking.nav.leaveConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
