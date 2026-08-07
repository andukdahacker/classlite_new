import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bold, Heading, Italic, List } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

import type { SaveState, WriteDocFormatCommand } from './WriteDocSurface'

/**
 * MobileWritingSurface — `s78` phone-sized writing canvas shell.
 * Story 1d-4 AC5; Story 5.3 AC18 (Winston S3 + Sally S2/S3).
 *
 * A PURPOSE-DESIGNED mobile component per UX-4 + UX-DR32 — NOT a responsive
 * squish of `WriteDocSurface`. Story 5.3 DE-FRAMES it to viewport-fluid (the
 * 1d-4 shell hardcoded `h-[844px] w-[390px] border shadow` — a storybook frame;
 * production needs full-bleed) and, when the caller supplies `stickyBarSlot`,
 * renders a real sticky bottom STRIP (word counter + an always-reachable Submit)
 * in place of the old floating `pointer-events-none` word pill.
 *
 * Body text uses Geist 16px (UX-4 minimum) with line-height 1.7 to give
 * Vietnamese IME composition the vertical room it needs.
 */
export interface MobileWritingSurfaceProps {
  title?: string
  content: ReactNode
  saveState: SaveState
  /** Numeric word count for the legacy floating pill (grading/storybook). */
  wordCount?: number
  onBack?: () => void
  onFormat?: (cmd: WriteDocFormatCommand) => void
  /**
   * Story 5.3 (AC5) — additive, default `true`. When `false` the formatting
   * toolbar is omitted (plain-text writing attempt, D1).
   */
  showToolbar?: boolean
  /**
   * Story 5.3 (AC10) — additive. When provided, REPLACES the built-in appbar save
   * pill (the writing attempt pins the prominent `SaveStatusIndicator`).
   */
  saveSlot?: ReactNode
  /** Story 5.3 (AC9) — additive calm due-date chip for the appbar. */
  dueSlot?: ReactNode
  /**
   * Story 5.3 (AC18) — additive. When provided, renders a STICKY BOTTOM STRIP
   * holding this content (the live word-counter strip + an always-reachable
   * Submit), replacing the legacy floating word pill. Grading consumers omit it.
   */
  stickyBarSlot?: ReactNode
}

const FORMAT_BUTTONS: ReadonlyArray<{
  cmd: WriteDocFormatCommand
  labelKey: string
  Icon: typeof Bold
}> = [
  { cmd: 'bold', labelKey: 'mobileWriting.toolbar.bold', Icon: Bold },
  { cmd: 'italic', labelKey: 'mobileWriting.toolbar.italic', Icon: Italic },
  { cmd: 'heading', labelKey: 'mobileWriting.toolbar.heading', Icon: Heading },
  { cmd: 'list', labelKey: 'mobileWriting.toolbar.list', Icon: List },
]

// `text-muted-foreground` was previously paired with `text-xs` on the
// save pill — same combo axe rejected at AA contrast across the AC2/AC3
// chrome remediation pass. Use `text-foreground` so the pulsing save
// indicator stays readable at 12px on the warm-surface app-bar.
const SAVE_TONE: Record<SaveState, string> = {
  saved: 'text-[color:var(--cl-green)]',
  saving: 'text-foreground animate-pulse',
  offline: 'text-[color:var(--cl-amber)]',
  error: 'text-destructive',
}

const SAVE_LABEL: Record<SaveState, string> = {
  saved: 'mobileWriting.save.saved',
  saving: 'mobileWriting.save.saving',
  offline: 'mobileWriting.save.offline',
  error: 'mobileWriting.save.error',
}

export function MobileWritingSurface({
  title,
  content,
  saveState,
  wordCount = 0,
  onBack,
  onFormat,
  showToolbar = true,
  saveSlot,
  dueSlot,
  stickyBarSlot,
}: MobileWritingSurfaceProps) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('mobileWriting.titlePlaceholder')
  return (
    <div
      data-testid="mobile-writing-surface"
      // Story 5.3 de-frame: full-bleed, viewport-fluid — no hardcoded phone frame.
      className="relative flex min-h-[100dvh] w-full flex-col overflow-hidden bg-[color:var(--cl-paper)] text-foreground"
      role="region"
      aria-label={t('mobileWriting.regionLabel')}
    >
      <div
        data-testid="mobile-writing-surface-appbar"
        className="flex items-center gap-2 border-b border-[color:var(--cl-line-soft)] bg-[color:var(--cl-surface-warm)] px-3 py-2"
      >
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={onBack}
          aria-label={t('mobileWriting.action.back')}
          data-testid="mobile-writing-surface-back"
          // AC18 — ensure the icon back button computes ≥44×44 CSS px.
          className="size-11"
        >
          <ArrowLeft aria-hidden="true" />
        </Button>
        <span
          data-testid="mobile-writing-surface-title"
          className="truncate text-sm font-medium text-foreground"
          aria-label={resolvedTitle}
        >
          {resolvedTitle}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {dueSlot}
          {saveSlot ?? (
            <span
              data-testid="mobile-writing-surface-save-pill"
              data-save-state={saveState}
              className={cn('text-xs font-medium', SAVE_TONE[saveState])}
            >
              {t(SAVE_LABEL[saveState])}
            </span>
          )}
        </div>
      </div>

      <div
        data-testid="mobile-writing-surface-body"
        className="flex-1 overflow-y-auto px-4 py-5 text-base leading-[1.7]"
        style={{ fontSize: '16px' }}
      >
        {content}
      </div>

      {stickyBarSlot ? (
        <div
          data-testid="mobile-writing-surface-sticky-bar"
          className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-[color:var(--cl-line-soft)] bg-[color:var(--cl-surface-warm)] px-4 py-2"
        >
          {stickyBarSlot}
        </div>
      ) : (
        <div
          data-testid="mobile-writing-surface-word-pill"
          className="pointer-events-none absolute bottom-16 right-4 rounded-full bg-foreground/85 px-3 py-1 text-xs font-medium text-background shadow"
        >
          {t('mobileWriting.footer.wordCount', { count: wordCount })}
        </div>
      )}

      {showToolbar ? (
        <div
          role="toolbar"
          aria-label={t('mobileWriting.toolbar.label')}
          data-testid="mobile-writing-surface-toolbar"
          className="flex items-center justify-around border-t border-[color:var(--cl-line-soft)] bg-[color:var(--cl-surface-warm)] px-3 py-2"
        >
          {FORMAT_BUTTONS.map(({ cmd, labelKey, Icon }) => (
            <Toggle
              key={cmd}
              size="lg"
              aria-label={t(labelKey)}
              data-testid={`mobile-writing-surface-format-${cmd}`}
              onPressedChange={() => onFormat?.(cmd)}
            >
              <Icon aria-hidden="true" />
            </Toggle>
          ))}
        </div>
      ) : null}
    </div>
  )
}
