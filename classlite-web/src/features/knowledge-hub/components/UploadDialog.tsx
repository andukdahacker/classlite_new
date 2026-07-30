/**
 * UploadDialog — the Knowledge Hub upload phase machine (Story 4.4b, AC3/AC4/AC7).
 *
 * The page (this dialog) owns the phase state machine over the three upload
 * primitives (presign → transfer → finalize). Design commitments from Sally's
 * party-mode bundle:
 *   - A9 layer-1 client pre-check rejects wrong-type / over-cap BEFORE presign,
 *     with the SAME copy a server reject would show (AC4b via uploadErrorCopy).
 *   - The progress bar's final segment reads "Finalizing…" and never hits a
 *     "success" state — success is the tile appearing in the grid (AC4a). So the
 *     transfer bar caps at 99% and only "Finalizing…" fills it.
 *   - Each stage has a DISTINCT human message; a raw HTTP code never surfaces.
 *   - Retry re-runs from presign WITHOUT re-selecting the file (AC4c); "survives
 *     interruption" is an honest re-PUT from zero, not resumable (AC4d).
 *   - At 100% storage the dialog leads with the role-split STORAGE_FULL block and
 *     does not let the teacher pick a file (AC7).
 */
import { useEffect, useRef, useState, type ChangeEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { UploadCloud, AlertTriangle } from 'lucide-react'
import { useRole } from '@/hooks/useRole'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress, ProgressLabel } from '@/components/ui/progress'
import {
  finalizeKnowledgeUpload,
  presignKnowledgeUpload,
  transferToStorage,
  type FileWire,
} from '../api/uploadKnowledgeFile'
import {
  KNOWLEDGE_ACCEPT_ATTR,
  precheckKnowledgeFile,
} from '../lib/knowledgeHubSchemas'
import {
  tooLargeCopy,
  uploadErrorCopy,
  wrongTypeCopy,
  type UploadErrorCopy,
} from '../lib/uploadErrorCopy'
import { storageFullBodyKey } from '../lib/storageCopy'

const TRANSFER_CEIL_PERCENT = 99 // reserve 100% for "Finalizing…" (AC4a)

type Phase =
  | { status: 'idle' }
  | { status: 'presigning'; file: File }
  | { status: 'transferring'; file: File; fraction: number }
  | { status: 'finalizing'; file: File }
  | { status: 'error'; file: File; copy: UploadErrorCopy }

interface UploadDialogProps {
  folderId: string | null
  storageFull: boolean
  open: boolean
  onOpenChange: (open: boolean) => void
  onUploaded: (file: FileWire) => void
}

export function UploadDialog({
  folderId,
  storageFull,
  open,
  onOpenChange,
  onUploaded,
}: UploadDialogProps): ReactElement {
  const { t } = useTranslation()
  const role = useRole()
  const inputRef = useRef<HTMLInputElement>(null)
  const [phase, setPhase] = useState<Phase>({ status: 'idle' })
  // A monotonic run id guards against a stale async callback from a superseded
  // upload (e.g. the user closed + reopened) writing phase state.
  const runIdRef = useRef(0)
  // Holds the in-flight transfer's controller so it can be aborted on unmount.
  const abortRef = useRef<AbortController | null>(null)

  // Abort any in-flight PUT if the dialog unmounts mid-transfer (route change),
  // so it can't keep streaming and orphan an R2 object. Cleanup-on-unmount is a
  // permitted useEffect use (not server-state fetching).
  useEffect(() => () => abortRef.current?.abort(), [])

  const busy = phase.status === 'presigning' || phase.status === 'transferring' || phase.status === 'finalizing'

  function reset(): void {
    runIdRef.current += 1
    setPhase({ status: 'idle' })
  }

  function handleOpenChange(next: boolean): void {
    if (busy) return // don't let a click-away abandon an in-flight upload silently
    if (!next) reset()
    onOpenChange(next)
  }

  async function runUpload(file: File): Promise<void> {
    const runId = (runIdRef.current += 1)
    const isCurrent = (): boolean => runIdRef.current === runId

    // A9 layer 1 — client pre-check (same copy as the server would show).
    const pre = precheckKnowledgeFile(file)
    if (!pre.ok) {
      setPhase({
        status: 'error',
        file,
        copy: pre.reason === 'too-large' ? tooLargeCopy(file) : wrongTypeCopy(),
      })
      return
    }

    setPhase({ status: 'presigning', file })
    let presigned
    try {
      presigned = await presignKnowledgeUpload(file)
    } catch (err) {
      if (isCurrent()) setPhase({ status: 'error', file, copy: uploadErrorCopy('presign', err, file) })
      return
    }
    if (!isCurrent()) return

    setPhase({ status: 'transferring', file, fraction: 0 })
    const controller = new AbortController()
    abortRef.current = controller
    try {
      await transferToStorage(
        presigned.url,
        file,
        (fraction) => {
          if (isCurrent()) setPhase({ status: 'transferring', file, fraction })
        },
        controller.signal,
      )
    } catch (err) {
      if (isCurrent()) setPhase({ status: 'error', file, copy: uploadErrorCopy('transfer', err, file) })
      return
    }
    if (!isCurrent()) return

    setPhase({ status: 'finalizing', file })
    let created: FileWire
    try {
      created = await finalizeKnowledgeUpload({
        key: presigned.key,
        name: file.name,
        folderId,
        sizeBytes: file.size,
      })
    } catch (err) {
      if (isCurrent()) setPhase({ status: 'error', file, copy: uploadErrorCopy('finalize', err, file) })
      return
    }
    if (!isCurrent()) return

    // Success is the tile appearing in the grid — close, don't render a "done".
    onUploaded(created)
    reset()
    onOpenChange(false)
  }

  function onFilePicked(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0]
    // Reset the input so re-picking the same file still fires onChange.
    event.target.value = ''
    if (file) void runUpload(file)
  }

  function openPicker(): void {
    inputRef.current?.click()
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent data-testid="kh-upload-dialog">
        <DialogHeader>
          <DialogTitle>{t('knowledgeHub.upload.title')}</DialogTitle>
          <DialogDescription>{t('knowledgeHub.upload.subtitle')}</DialogDescription>
        </DialogHeader>

        <input
          ref={inputRef}
          type="file"
          accept={KNOWLEDGE_ACCEPT_ATTR}
          className="sr-only"
          onChange={onFilePicked}
          data-testid="kh-upload-input"
          aria-hidden="true"
          tabIndex={-1}
        />

        {storageFull ? (
          <StorageFullBlock bodyKey={storageFullBodyKey(role)} />
        ) : phase.status === 'idle' ? (
          <IdlePicker onPick={openPicker} />
        ) : phase.status === 'error' ? (
          <ErrorState
            phase={phase}
            role={role}
            onRetry={phase.copy.retryable ? () => void runUpload(phase.file) : null}
            onPickAnother={openPicker}
          />
        ) : (
          <ProgressState phase={phase} />
        )}
      </DialogContent>
    </Dialog>
  )
}

function IdlePicker({ onPick }: { onPick: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-slate-300 px-6 py-10 text-center"
      data-testid="kh-upload-idle"
    >
      <UploadCloud className="size-8 text-slate-400" aria-hidden="true" />
      <p className="text-sm text-slate-500">{t('knowledgeHub.upload.hint')}</p>
      <Button onClick={onPick} data-testid="kh-upload-pick">
        {t('knowledgeHub.upload.pick')}
      </Button>
      <p className="text-xs text-slate-400">{t('knowledgeHub.upload.accepted')}</p>
    </div>
  )
}

function ProgressState({
  phase,
}: {
  phase: Extract<Phase, { status: 'presigning' | 'transferring' | 'finalizing' }>
}): ReactElement {
  const { t } = useTranslation()
  const { value, labelKey } = progressView(phase)
  return (
    <div className="space-y-3 py-4" data-testid="kh-upload-progress" role="status" aria-live="polite">
      <p className="truncate text-sm font-medium text-slate-700" data-testid="kh-upload-filename">
        {phase.file.name}
      </p>
      <Progress value={value} aria-label={t(labelKey)}>
        <ProgressLabel data-testid="kh-upload-phase-label">{t(labelKey)}</ProgressLabel>
      </Progress>
    </div>
  )
}

/** progressView maps a live phase to a 0–100 bar value + its label key. The
 * transfer bar caps below 100 so a full bar only ever means "Finalizing…". */
function progressView(
  phase: Extract<Phase, { status: 'presigning' | 'transferring' | 'finalizing' }>,
): { value: number; labelKey: string } {
  if (phase.status === 'presigning') {
    return { value: 2, labelKey: 'knowledgeHub.upload.phase.preparing' }
  }
  if (phase.status === 'transferring') {
    return {
      value: Math.min(TRANSFER_CEIL_PERCENT, Math.round(phase.fraction * 100)),
      labelKey: 'knowledgeHub.upload.phase.uploading',
    }
  }
  return { value: 100, labelKey: 'knowledgeHub.upload.phase.finalizing' }
}

function ErrorState({
  phase,
  role,
  onRetry,
  onPickAnother,
}: {
  phase: Extract<Phase, { status: 'error' }>
  role: ReturnType<typeof useRole>
  onRetry: (() => void) | null
  onPickAnother: () => void
}): ReactElement {
  const { t } = useTranslation()
  const { copy, file } = phase
  // A storage-full reject at the finalize seam (messageKey null) gets the SAME
  // role-split copy as the pre-open block (AC7): owner sees the upgrade/delete
  // CTA, a member sees "ask your owner".
  const message = copy.messageKey
    ? t(copy.messageKey, copy.params)
    : t(storageFullBodyKey(role))
  return (
    <div className="space-y-3 py-2" data-testid="kh-upload-error">
      <div
        role="alert"
        className="flex items-start gap-2 rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
      >
        <AlertTriangle className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
        <span data-testid="kh-upload-error-message">{message}</span>
      </div>
      <p className="truncate text-xs text-slate-400">{file.name}</p>
      <div className="flex gap-2">
        {onRetry ? (
          <Button onClick={onRetry} data-testid="kh-upload-retry">
            {t('knowledgeHub.upload.retry')}
          </Button>
        ) : null}
        <Button variant="outline" onClick={onPickAnother} data-testid="kh-upload-pick-another">
          {t('knowledgeHub.upload.pickAnother')}
        </Button>
      </div>
    </div>
  )
}

function StorageFullBlock({ bodyKey }: { bodyKey: string }): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      className="space-y-2 rounded-md border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] px-4 py-3 text-sm"
      role="alert"
      data-testid="kh-upload-storage-full"
    >
      <p className="font-medium text-[color:var(--cl-amber)]">{t('knowledgeHub.storage.full.title')}</p>
      <p className="text-slate-600">{t(bodyKey)}</p>
    </div>
  )
}
