import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Bold, Heading, Italic, List } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Toggle } from '@/components/ui/toggle'
import { cn } from '@/lib/utils'

import type { SaveState, WriteDocFormatCommand } from './WriteDocSurface'

/**
 * MobileWritingSurface — `s78` phone-sized writing canvas shell.
 * Story 1d-4 AC5.
 *
 * Static visual identity only. Behavior — mobile autosave, IME
 * composition handling, real word counter — ships in Epic 5 Story 5.3
 * mobile variant. This is a PURPOSE-DESIGNED mobile component per UX-4 +
 * UX-DR32 — NOT a responsive squish of `WriteDocSurface`. Fixed top
 * app-bar + fixed bottom toolbar own the viewport edges; the sticky word
 * pill floats above the toolbar when the body scrolls.
 *
 * Body text uses Geist 16px (UX-4 minimum) with line-height 1.7 to give
 * Vietnamese IME composition the vertical room it needs.
 */
export interface MobileWritingSurfaceProps {
  title?: string
  content: ReactNode
  saveState: SaveState
  wordCount: number
  onBack?: () => void
  onFormat?: (cmd: WriteDocFormatCommand) => void
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
  wordCount,
  onBack,
  onFormat,
}: MobileWritingSurfaceProps) {
  const { t } = useTranslation()
  const resolvedTitle = title ?? t('mobileWriting.titlePlaceholder')
  return (
    <div
      data-testid="mobile-writing-surface"
      className="relative flex h-[844px] w-[390px] flex-col overflow-hidden border border-[color:var(--cl-line-soft)] bg-[color:var(--cl-paper)] text-foreground shadow-sm"
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
        <span
          data-testid="mobile-writing-surface-save-pill"
          data-save-state={saveState}
          className={cn('ml-auto text-xs font-medium', SAVE_TONE[saveState])}
        >
          {t(SAVE_LABEL[saveState])}
        </span>
      </div>

      <div
        data-testid="mobile-writing-surface-body"
        className="flex-1 overflow-y-auto px-4 py-5 text-base leading-[1.7]"
        style={{ fontSize: '16px' }}
      >
        {content}
      </div>

      <div
        data-testid="mobile-writing-surface-word-pill"
        className="pointer-events-none absolute bottom-16 right-4 rounded-full bg-foreground/85 px-3 py-1 text-xs font-medium text-background shadow"
      >
        {t('mobileWriting.footer.wordCount', { count: wordCount })}
      </div>

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
    </div>
  )
}
