import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Bold, Heading, Italic, List } from 'lucide-react'

import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

/**
 * WriteDocSurface — `s34` Docs-style writing canvas shell. Story 1d-4 AC1.
 *
 * Static visual identity only. Behavior — debounced autosave, draft
 * recovery via `localStorage`, real timer — ships in Epic 5 Story 5.3.
 *
 * Three-state stories cover the VISUAL SHAPE for design review only; real
 * loading-state correctness lives at the consumer story in Epic 5.
 *
 * Save-indicator chrome is fixture-driven (`saveState` + optional ISO
 * `savedAt`). Per TS-6 the ISO string stays in the `<time dateTime>`
 * machine attribute; consumers pass a pre-formatted `savedAtLabel` for
 * the visible text — no `new Date()` here.
 */
export type SaveState = 'saved' | 'saving' | 'offline' | 'error'

export type WriteDocFormatCommand = 'bold' | 'italic' | 'heading' | 'list'

export interface WriteDocSurfaceProps {
  title?: string
  content: ReactNode
  saveState: SaveState
  /** ISO timestamp string — never `new Date()` per TS-6. */
  savedAt?: string
  /** Pre-formatted relative-time label (e.g. `Saved 2 mins ago`). Real i18n in Epic 5. */
  savedAtLabel?: string
  wordCount: number
  /** Seconds. Rendered as `M:SS`. */
  timeOnTaskSec: number
  onFormat?: (cmd: WriteDocFormatCommand) => void
  /**
   * Story 5.3 (AC5) — additive, default `true`. When `false` the formatting
   * toolbar is not rendered (plain-text writing attempt, D1) and the header/body
   * separator the toolbar's `border-y` provided is restored (Sally N1). Grading
   * consumers omit it and keep the toolbar.
   */
  showToolbar?: boolean
  /**
   * Story 5.3 (AC10) — additive. When provided, REPLACES the built-in save pill
   * in the header (the writing attempt passes the prominent `SaveStatusIndicator`
   * so the corner pill is not the authoritative indicator). Grading consumers omit
   * it and keep the built-in pill.
   */
  saveSlot?: ReactNode
  /**
   * Story 5.3 (AC9) — additive calm due-date countdown slot, rendered in the
   * header. Grading consumers omit it.
   */
  dueCountdown?: ReactNode
  /**
   * Story 5.3 (AC6) — additive. When provided, REPLACES the numeric footer word
   * count with an isolated live meter (so a keystroke re-renders only the meter,
   * never this shell / the timers — BLOCKER 2). Grading consumers omit it and keep
   * the numeric `wordCount`.
   */
  wordCountSlot?: ReactNode
  /**
   * Story 5.3 (AC8) — additive. When provided, REPLACES the numeric footer
   * time-on-task with an isolated live meter. Grading consumers omit it.
   */
  timeSlot?: ReactNode
}

const FORMAT_BUTTONS: ReadonlyArray<{
  cmd: WriteDocFormatCommand
  labelKey: string
  Icon: typeof Bold
}> = [
  { cmd: 'bold', labelKey: 'writeDocSurface.toolbar.bold', Icon: Bold },
  { cmd: 'italic', labelKey: 'writeDocSurface.toolbar.italic', Icon: Italic },
  { cmd: 'heading', labelKey: 'writeDocSurface.toolbar.heading', Icon: Heading },
  { cmd: 'list', labelKey: 'writeDocSurface.toolbar.list', Icon: List },
]

const SAVE_PILL: Record<
  SaveState,
  { labelKey: string; tone: string }
> = {
  saved: {
    labelKey: 'writeDocSurface.save.saved',
    tone: 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]',
  },
  saving: {
    labelKey: 'writeDocSurface.save.saving',
    tone: 'bg-muted text-muted-foreground animate-pulse',
  },
  offline: {
    labelKey: 'writeDocSurface.save.offline',
    tone: 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
  },
  error: {
    labelKey: 'writeDocSurface.save.error',
    tone: 'bg-destructive/10 text-destructive',
  },
}

function formatTimeOnTask(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00'
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const remainder = total % 60
  return `${minutes}:${remainder.toString().padStart(2, '0')}`
}

export function WriteDocSurface({
  title,
  content,
  saveState,
  savedAt,
  savedAtLabel,
  wordCount,
  timeOnTaskSec,
  onFormat,
  showToolbar = true,
  saveSlot,
  dueCountdown,
  wordCountSlot,
  timeSlot,
}: WriteDocSurfaceProps) {
  const { t } = useTranslation()
  const pill = SAVE_PILL[saveState]
  const resolvedTitle = title ?? t('writeDocSurface.titlePlaceholder')
  return (
    <section
      data-testid="write-doc-surface"
      className="mx-auto flex w-full max-w-3xl flex-col gap-4 rounded-2xl border border-[color:var(--cl-line-soft)] bg-[color:var(--cl-paper)] p-6 shadow-sm"
      aria-label={t('writeDocSurface.regionLabel')}
    >
      <header
        data-testid="write-doc-surface-title-bar"
        className={cn(
          'flex items-center justify-between gap-3',
          // Sally N1 — with the toolbar off, restore the header/body separator
          // the toolbar's `border-y` used to provide.
          !showToolbar &&
            'border-b border-[color:var(--cl-line-soft)] pb-3',
        )}
      >
        <h2
          className="font-heading text-3xl text-foreground"
          data-testid="write-doc-surface-title"
        >
          {resolvedTitle}
        </h2>
        <div className="flex items-center gap-3">
          {dueCountdown}
          {saveSlot ?? (
            <div
              data-testid="write-doc-surface-save-pill"
              data-save-state={saveState}
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium',
                pill.tone,
              )}
            >
              <span>{t(pill.labelKey)}</span>
              {saveState === 'saved' && savedAt ? (
                <time
                  dateTime={savedAt}
                  className="font-mono text-[0.7rem]"
                  data-testid="write-doc-surface-saved-at"
                >
                  {savedAtLabel ?? savedAt}
                </time>
              ) : null}
            </div>
          )}
        </div>
      </header>

      {showToolbar ? (
        <div
          role="toolbar"
          aria-label={t('writeDocSurface.toolbar.label')}
          data-testid="write-doc-surface-toolbar"
          className="flex items-center gap-1 border-y border-[color:var(--cl-line-soft)] py-1"
        >
          {FORMAT_BUTTONS.map(({ cmd, labelKey, Icon }) => (
            <Toggle
              key={cmd}
              size="sm"
              aria-label={t(labelKey)}
              data-testid={`write-doc-surface-format-${cmd}`}
              onPressedChange={() => onFormat?.(cmd)}
            >
              <Icon aria-hidden="true" />
            </Toggle>
          ))}
        </div>
      ) : null}

      <div
        contentEditable={false}
        data-testid="write-doc-surface-body"
        className="min-h-[18rem] w-full max-w-[65ch] self-center font-sans text-base leading-relaxed text-foreground"
      >
        {content}
      </div>

      <footer
        data-testid="write-doc-surface-footer"
        className="flex flex-wrap items-center justify-between gap-2 border-t border-[color:var(--cl-line-soft)] pt-3 text-xs text-foreground"
      >
        {wordCountSlot ?? (
          <span data-testid="write-doc-surface-word-count">
            {t('writeDocSurface.footer.wordCount', { count: wordCount })}
          </span>
        )}
        {timeSlot ?? (
          <span
            data-testid="write-doc-surface-time-on-task"
            className="font-mono"
          >
            {t('writeDocSurface.footer.timeOnTask', {
              time: formatTimeOnTask(timeOnTaskSec),
            })}
          </span>
        )}
      </footer>
    </section>
  )
}
