/**
 * EditorAutoSaveIndicator — Story 4.2 (AC6/AC9). Renders the five enumerated
 * autosave states from `editorStore`:
 *   - idle    → "Auto-save on"
 *   - saving  → "Saving…"
 *   - saved   → "Auto-saved · just now" (< JUST_NOW_WINDOW_S) / "· {N}s|m ago"
 *   - unsaved → "Unsaved — add a title" (the validity-gate hold, NOT a failure)
 *   - error   → "Save failed — retry" + a retry button (flush)
 *
 * `aria-live="polite"` announces STATE TRANSITIONS only — the ticking relative
 * time is aria-hidden so a screen reader is not assaulted every second
 * (mirrors onboarding AutoSaveIndicator). "just now" / "vừa xong" is its OWN
 * string, not `{{seconds}}: 0` of the relative message (TS-6 + Sally).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useEditorStore, type SaveStatus } from '@/stores/editorStore'

const TICK_INTERVAL_MS = 1_000
const JUST_NOW_WINDOW_S = 5
const SECONDS_PER_MINUTE = 60

export interface EditorAutoSaveIndicatorProps {
  /** Flush + retry — the manual "Save exercise" affordance (AC6). */
  onRetry: () => void
}

export function EditorAutoSaveIndicator({ onRetry }: EditorAutoSaveIndicatorProps) {
  const { t } = useTranslation()
  const saveStatus = useEditorStore((s) => s.saveStatus)
  const lastSavedAt = useEditorStore((s) => s.lastSavedAt)
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (saveStatus !== 'saved' || lastSavedAt === null) return
    const id = setInterval(() => setNow(Date.now()), TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [saveStatus, lastSavedAt])

  const visibleLabel = visibleMessage(t, saveStatus, lastSavedAt, now)
  const announcement = stateAnnouncement(t, saveStatus)

  if (saveStatus === 'error') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 text-sm text-destructive"
        data-testid="editor-autosave-error"
      >
        <span>{t('exercises.editor.autosave.failed')}</span>
        <button
          type="button"
          onClick={onRetry}
          className="rounded border border-destructive/40 px-2 py-0.5 text-xs font-medium hover:bg-destructive/10"
          data-testid="editor-autosave-retry"
        >
          {t('exercises.editor.autosave.retry')}
        </button>
      </div>
    )
  }

  return (
    <div className="text-sm text-muted-foreground" data-testid="editor-autosave-indicator">
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <span aria-hidden="true" data-status={saveStatus}>
        {visibleLabel}
      </span>
    </div>
  )
}

function stateAnnouncement(
  t: (key: string, params?: Record<string, unknown>) => string,
  status: SaveStatus,
): string {
  switch (status) {
    case 'saving':
      return t('exercises.editor.autosave.saving')
    case 'saved':
      // Static announcement — the ticking relative time is visual-only.
      return t('exercises.editor.autosave.savedAnnouncement')
    case 'unsaved':
      return t('exercises.editor.autosave.unsavedTitle')
    case 'error':
      return t('exercises.editor.autosave.failed')
    case 'idle':
    default:
      return t('exercises.editor.autosave.idle')
  }
}

function visibleMessage(
  t: (key: string, params?: Record<string, unknown>) => string,
  status: SaveStatus,
  lastSavedAt: string | null,
  nowMs: number,
): string {
  switch (status) {
    case 'saving':
      return t('exercises.editor.autosave.saving')
    case 'unsaved':
      return t('exercises.editor.autosave.unsavedTitle')
    case 'saved': {
      if (lastSavedAt === null) return t('exercises.editor.autosave.savedJustNow')
      const parsed = Date.parse(lastSavedAt)
      if (!Number.isFinite(parsed)) return t('exercises.editor.autosave.idle')
      const elapsed = Math.max(0, Math.floor((nowMs - parsed) / 1000))
      if (elapsed < JUST_NOW_WINDOW_S) return t('exercises.editor.autosave.savedJustNow')
      if (elapsed < SECONDS_PER_MINUTE) {
        return t('exercises.editor.autosave.savedSecondsAgo', { seconds: elapsed })
      }
      return t('exercises.editor.autosave.savedMinutesAgo', {
        minutes: Math.floor(elapsed / SECONDS_PER_MINUTE),
      })
    }
    case 'idle':
    default:
      return t('exercises.editor.autosave.idle')
  }
}
