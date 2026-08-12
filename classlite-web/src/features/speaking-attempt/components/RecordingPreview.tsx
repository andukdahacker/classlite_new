/**
 * RecordingPreview — Story 5.4 Task 6 (AC8). Plays the completed take back in a
 * native `<audio controls>` fed the Blob's object-URL. The URL lifecycle (create /
 * revoke on re-record/unmount) is owned by `useMediaRecorder` — this component only
 * renders. No grading waveform (Epic 6). A "Record again" affordance re-records.
 */
import { useTranslation } from 'react-i18next'

export interface RecordingPreviewProps {
  objectUrl: string
  onReRecord: () => void
  /** Read-only attempt — the take can be played back but not discarded/re-recorded. */
  disabled?: boolean
}

export function RecordingPreview({ objectUrl, onReRecord, disabled = false }: RecordingPreviewProps) {
  const { t } = useTranslation()
  return (
    <div data-testid="speaking-preview" className="flex flex-col items-stretch gap-3">
      <p className="text-sm text-[color:var(--cl-ink-soft)]">{t('speaking.preview.label')}</p>
      <audio
        controls
        src={objectUrl}
        data-testid="speaking-preview-audio"
        className="w-full"
      >
        {t('speaking.preview.unsupported')}
      </audio>
      <button
        type="button"
        onClick={onReRecord}
        disabled={disabled}
        data-testid="speaking-rerecord"
        className="min-h-12 self-center rounded-md border border-[color:var(--cl-line-soft)] px-4 text-base font-medium text-[color:var(--cl-ink)] hover:bg-[color:var(--cl-tint-red)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {t('speaking.record.reRecord')}
      </button>
    </div>
  )
}
