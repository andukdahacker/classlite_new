/**
 * ImportStudentsPage — Story 2.7 bulk student import (AC1/AC3/AC5).
 *
 * Flow: dropzone/browse → client-side type gate → presigned upload → server
 * preview (parse + classify) → confirm (partial import) → result screen with the
 * persisted roster inline (self-verification, since the s42 center-wide list is
 * Story 7.2) + a downloadable error report.
 *
 * Contracts pinned here:
 *   - Confirm stays ENABLED with error rows (partial import) — the summary banner
 *     is display-only, NOT an s65 disable-until-clean gate (AC3).
 *   - Submit-lock: Confirm is disabled while a confirm is in flight (concurrency).
 *   - UX-1 trilogy (loading skeleton on the parse wait, empty/idle dropzone,
 *     error alerts with retry); i18n-only copy (TEST-FE-4); aria-live summary +
 *     per-row accessible labels (TEST-UX-2).
 */
import { useRef, useState, type DragEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
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
import { ApiError } from '@/lib/api-fetch'
import { uploadImportFile } from './api/useUploadImportFile'
import { useImportPreview, type ImportPreviewRow } from './api/useImportPreview'
import { useConfirmImport, type ImportResultRow } from './api/useConfirmImport'
import type { ImportPreview } from './api/useImportPreview'
import type { ImportResult } from './api/useConfirmImport'
import { importFileSchema } from './lib/schemas'
import { downloadCsv, serializeCsv } from './lib/downloadCsv'

type Phase = 'idle' | 'uploading' | 'parsing' | 'preview' | 'result'

/** Maps a thrown error to a specific i18n message key, so a too-large file /
 * 200-row rejection / missing upload / malformed header is surfaced with its own
 * copy instead of the generic fallback. `apiFetch` throws a typed `ApiError`
 * carrying the backend `code`; a raw R2 PUT failure is a plain Error → fallback. */
function importErrorKey(err: unknown, fallbackKey: string): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'IMPORT_ROW_LIMIT_EXCEEDED':
        return 'people.import.errors.rowLimit'
      case 'IMPORT_FILE_TOO_LARGE':
        return 'people.import.errors.fileTooLarge'
      case 'IMPORT_FILE_NOT_FOUND':
        return 'people.import.errors.fileNotFound'
      case 'VALIDATION_ERROR':
        return 'people.import.errors.malformedFile'
    }
  }
  return fallbackKey
}

/** crypto.randomUUID is unavailable in non-secure contexts (plain-HTTP LAN
 * host); fall back to a v4-shaped id for the audit-only importId correlation. */
function newImportId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

type RowStatus = ImportPreviewRow['status']

const STATUS_BADGE_VARIANT: Record<
  RowStatus,
  'default' | 'secondary' | 'outline' | 'destructive'
> = {
  new_user: 'default',
  existing_user: 'secondary',
  unassigned: 'outline',
  validation_error: 'destructive',
}

const PERCENT = 100

export default function ImportStudentsPage(): ReactElement {
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [phase, setPhase] = useState<Phase>('idle')
  const [dragOver, setDragOver] = useState(false)
  const [fileError, setFileError] = useState<string | null>(null)
  const [flowError, setFlowError] = useState<string | null>(null)
  const [uploadFraction, setUploadFraction] = useState(0)
  const [objectKey, setObjectKey] = useState<string | null>(null)
  const [preview, setPreview] = useState<ImportPreview | null>(null)
  const [result, setResult] = useState<ImportResult | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)

  const previewMutation = useImportPreview()
  const confirmMutation = useConfirmImport()

  const resetToIdle = () => {
    setPhase('idle')
    setPreview(null)
    setResult(null)
    setObjectKey(null)
    setFlowError(null)
    setUploadFraction(0)
  }

  async function handleFile(file: File): Promise<void> {
    setFileError(null)
    setFlowError(null)
    const parsed = importFileSchema.safeParse(file)
    if (!parsed.success) {
      setFileError(parsed.error.issues[0]?.message ?? 'people.import.errors.wrongType')
      return
    }
    setPhase('uploading')
    setUploadFraction(0)
    try {
      const { key } = await uploadImportFile(file, setUploadFraction)
      setObjectKey(key)
      setPhase('parsing')
      const previewData = await previewMutation.mutateAsync({ key })
      setPreview(previewData)
      setPhase('preview')
    } catch (err) {
      // Preserve the ability to re-pick after a failure; surface the specific
      // cause (row-limit / too-large / not-found / malformed) when known.
      setFlowError(importErrorKey(err, 'people.import.errors.uploadFailed'))
      setPhase('idle')
    }
  }

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault()
    setDragOver(false)
    const file = event.dataTransfer.files?.[0]
    if (file) void handleFile(file)
  }

  async function handleConfirm(): Promise<void> {
    // Guard the double-submit window: the dialog action button is not itself
    // disabled while the confirm is in flight, so a fast double-click could fire
    // twice before Radix unmounts the dialog.
    if (!objectKey || confirmMutation.isPending) return
    setConfirmOpen(false)
    setFlowError(null)
    try {
      const importId = newImportId()
      const res = await confirmMutation.mutateAsync({ key: objectKey, importId })
      setResult(res)
      setPhase('result')
    } catch (err) {
      setFlowError(importErrorKey(err, 'people.import.errors.confirmFailed'))
    }
  }

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold text-foreground">{t('people.import.title')}</h1>
        <p className="text-sm text-muted-foreground">{t('people.import.subtitle')}</p>
      </header>

      {phase === 'idle' && (
        <IdleDropzone
          dragOver={dragOver}
          fileError={fileError}
          flowError={flowError}
          onBrowse={() => fileInputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOver(true)
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
        />
      )}

      {phase === 'uploading' && (
        <section aria-live="polite" className="flex flex-col gap-3 rounded-lg border p-6">
          <p className="text-sm text-foreground">{t('people.import.phase.uploading')}</p>
          <Progress
            value={Math.round(uploadFraction * PERCENT)}
            aria-label={t('people.import.phase.uploading')}
          />
        </section>
      )}

      {phase === 'parsing' && <ParsingSkeleton label={t('people.import.phase.parsing')} />}

      {phase === 'preview' && preview && (
        <PreviewSection
          preview={preview}
          canConfirm={preview.summary.willImport > 0}
          confirming={confirmMutation.isPending}
          flowError={flowError}
          onCancel={resetToIdle}
          onConfirm={() => setConfirmOpen(true)}
        />
      )}

      {phase === 'result' && result && <ResultSection result={result} onDone={resetToIdle} />}

      {/* Hidden native picker — the dropzone/browse both drive it. */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".csv,.xlsx"
        className="sr-only"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0]
          // Reset the value so re-picking the SAME file after an error re-fires.
          e.target.value = ''
          if (file) void handleFile(file)
        }}
      />

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('people.import.confirmDialog.title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('people.import.confirmDialog.body', {
                willImport: preview?.summary.willImport ?? 0,
                willSkip: preview?.summary.willSkip ?? 0,
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('people.import.confirmDialog.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void handleConfirm()}
              disabled={confirmMutation.isPending}
            >
              {t('people.import.confirmDialog.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  )
}

interface IdleDropzoneProps {
  dragOver: boolean
  fileError: string | null
  flowError: string | null
  onBrowse: () => void
  onDragOver: (e: DragEvent<HTMLDivElement>) => void
  onDragLeave: () => void
  onDrop: (e: DragEvent<HTMLDivElement>) => void
}

function IdleDropzone({
  dragOver,
  fileError,
  flowError,
  onBrowse,
  onDragOver,
  onDragLeave,
  onDrop,
}: IdleDropzoneProps): ReactElement {
  const { t } = useTranslation()
  return (
    <section className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('people.import.dropzone.browse')}
        onClick={onBrowse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onBrowse()
          }
        }}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        data-testid="import-dropzone"
        data-drag-over={dragOver}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-10 text-center transition-colors ${
          dragOver ? 'border-primary bg-primary/5' : 'border-border'
        }`}
      >
        <p className="font-medium text-foreground">
          {dragOver ? t('people.import.dropzone.dragActive') : t('people.import.dropzone.idle')}
        </p>
        <p className="text-sm text-muted-foreground">{t('people.import.dropzone.hint')}</p>
        <Button type="button" variant="outline">
          {t('people.import.dropzone.browse')}
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">{t('people.import.columns.help')}</p>
      {fileError && <InlineError message={t(fileError)} />}
      {flowError && <InlineError message={t(flowError)} />}
    </section>
  )
}

function ParsingSkeleton({ label }: { label: string }): ReactElement {
  return (
    <section aria-live="polite" aria-busy="true" className="flex flex-col gap-3 rounded-lg border p-6">
      <p className="text-sm text-foreground">{label}</p>
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} className="h-6 w-full" data-testid="import-parse-skeleton" />
      ))}
    </section>
  )
}

interface PreviewSectionProps {
  preview: ImportPreview
  canConfirm: boolean
  confirming: boolean
  flowError: string | null
  onCancel: () => void
  onConfirm: () => void
}

function PreviewSection({
  preview,
  canConfirm,
  confirming,
  flowError,
  onCancel,
  onConfirm,
}: PreviewSectionProps): ReactElement {
  const { t } = useTranslation()
  const { summary, rows } = preview
  return (
    <section className="flex flex-col gap-4">
      <div
        role="status"
        aria-live="polite"
        data-testid="import-summary-banner"
        className="rounded-md bg-muted p-3 text-sm text-foreground"
      >
        {t('people.import.summary.banner', {
          willImport: summary.willImport,
          willSkip: summary.willSkip,
        })}
        {summary.unassigned > 0 && (
          <span className="ml-2 text-muted-foreground">
            {t('people.import.summary.unassignedWarning', { count: summary.unassigned })}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <p
          role="status"
          data-testid="import-preview-empty"
          className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground"
        >
          {t('people.import.preview.empty')}
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <Table>
            <TableCaption className="sr-only">{t('people.import.preview.tableCaption')}</TableCaption>
            <TableHeader>
              <TableRow>
                <TableHead>{t('people.import.preview.colRow')}</TableHead>
                <TableHead>{t('people.import.preview.colEmail')}</TableHead>
                <TableHead>{t('people.import.preview.colName')}</TableHead>
                <TableHead>{t('people.import.preview.colClass')}</TableHead>
                <TableHead>{t('people.import.preview.colStatus')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <PreviewRow key={row.rowNumber} row={row} />
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {flowError && <InlineError message={t(flowError)} />}

      <div className="flex items-center justify-end gap-3">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={confirming}>
          {t('people.import.preview.cancel')}
        </Button>
        <Button
          type="button"
          onClick={onConfirm}
          disabled={!canConfirm || confirming}
          data-testid="import-confirm-button"
        >
          {confirming
            ? t('people.import.preview.confirming')
            : t('people.import.preview.confirm')}
        </Button>
      </div>
    </section>
  )
}

function PreviewRow({ row }: { row: ImportPreviewRow }): ReactElement {
  const { t } = useTranslation()
  const reasonKey = row.error ? `people.import.rowError.${row.error}` : ''
  const reasonText = reasonKey ? t(reasonKey, { defaultValue: row.error }) : ''
  // A11y: label ties the row identity to its status + reason (TEST-UX-2).
  const accessibleLabel = t('people.import.preview.rowLabel', {
    row: row.rowNumber,
    email: row.email,
    status: t(`people.import.status.${row.status}`),
    reason: reasonText,
  })
  return (
    <TableRow data-testid="import-preview-row">
      <TableCell>{row.rowNumber}</TableCell>
      <TableCell>{row.email}</TableCell>
      <TableCell>{row.fullName}</TableCell>
      <TableCell>{row.className || '—'}</TableCell>
      <TableCell>
        <Badge variant={STATUS_BADGE_VARIANT[row.status]} aria-label={accessibleLabel}>
          {t(`people.import.status.${row.status}`)}
        </Badge>
        {reasonText && (
          <span className="ml-2 text-xs text-muted-foreground">{reasonText}</span>
        )}
      </TableCell>
    </TableRow>
  )
}

interface ResultSectionProps {
  result: ImportResult
  onDone: () => void
}

function ResultSection({ result, onDone }: ResultSectionProps): ReactElement {
  const { t } = useTranslation()

  // One source of truth for "failed": non-persisted rows. The download gate and
  // the report body both derive from this so they can never disagree.
  const failedRows = result.rows.filter((r) => !r.persisted)

  const downloadErrorReport = () => {
    const header = [
      t('people.import.result.errorCsv.rowNumber'),
      t('people.import.result.errorCsv.email'),
      t('people.import.result.errorCsv.reason'),
    ]
    // Localize the reason column to match the on-screen copy, not the raw code.
    const body = failedRows.map((r) => [
      String(r.rowNumber),
      r.email,
      r.error ? t(`people.import.rowError.${r.error}`, { defaultValue: r.error }) : '',
    ])
    downloadCsv('student-import-errors.csv', serializeCsv(header, body))
  }

  const hasFailures = failedRows.length > 0
  return (
    <section className="flex flex-col gap-4">
      <div
        role="status"
        aria-live="polite"
        data-testid="import-result-summary"
        className="rounded-md bg-muted p-3 text-sm text-foreground"
      >
        {t('people.import.result.summary', {
          created: result.created,
          failed: result.failed,
        })}
        <span data-testid="import-result-skipped-count" className="sr-only">
          {result.failed}
        </span>
      </div>

      {!result.invitesSent && result.created > 0 && (
        <InlineError message={t('people.import.result.invitesNotAllSent')} />
      )}

      <div className="overflow-x-auto rounded-lg border">
        <Table>
          <TableCaption className="sr-only">{t('people.import.result.tableCaption')}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t('people.import.preview.colRow')}</TableHead>
              <TableHead>{t('people.import.preview.colEmail')}</TableHead>
              <TableHead>{t('people.import.result.colPersisted')}</TableHead>
              <TableHead>{t('people.import.preview.colStatus')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {result.rows.map((row) => (
              <ResultRow key={row.rowNumber} row={row} />
            ))}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between gap-3">
        {hasFailures ? (
          <Button
            type="button"
            variant="outline"
            onClick={downloadErrorReport}
            data-testid="import-error-report-download"
          >
            {t('people.import.result.downloadErrors')}
          </Button>
        ) : (
          <span />
        )}
        <Button type="button" onClick={onDone}>
          {t('people.import.result.done')}
        </Button>
      </div>
    </section>
  )
}

function ResultRow({ row }: { row: ImportResultRow }): ReactElement {
  const { t } = useTranslation()
  const reasonText = row.error
    ? t(`people.import.rowError.${row.error}`, { defaultValue: row.error })
    : ''
  return (
    <TableRow data-testid="import-result-roster-row">
      <TableCell>{row.rowNumber}</TableCell>
      <TableCell>{row.email}</TableCell>
      <TableCell>
        {row.persisted ? (
          <Badge variant="secondary">{t('people.import.result.persistedYes')}</Badge>
        ) : (
          <Badge variant="destructive">{t('people.import.result.persistedNo')}</Badge>
        )}
      </TableCell>
      <TableCell>
        {t(`people.import.status.${row.status}`)}
        {reasonText && <span className="ml-2 text-xs text-muted-foreground">{reasonText}</span>}
      </TableCell>
    </TableRow>
  )
}

function InlineError({ message }: { message: string }): ReactElement {
  return (
    <p role="alert" className="text-sm text-destructive">
      {message}
    </p>
  )
}
