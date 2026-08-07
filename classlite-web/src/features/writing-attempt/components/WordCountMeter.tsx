/**
 * WordCountMeter — Story 5.3 Task 2 (AC6/AC7/AC18). The live "{count} / {min} min"
 * word counter with a "+N above / N below min" delta. Subscribes to the shared
 * live-text store via `useSyncExternalStore`, so a keystroke re-renders ONLY this
 * meter — never the shell or the ticking timers (BLOCKER 2). The same component
 * renders in the desktop footer and the mobile sticky word-counter strip (AC18).
 *
 * The count is decoupled from the 30s autosave — it tracks the live editor value
 * and updates before any PUT (AC6). `aria-live="polite"` is intentionally omitted:
 * the count is glanceable, not announced per keystroke (the under-length state is
 * surfaced at submit, AC7).
 */
import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { countWords } from '../lib/writingContent'
import type { LiveTextStore } from '../lib/liveTextStore'

export interface WordCountMeterProps {
  store: LiveTextStore
  min: number
}

export function WordCountMeter({ store, min }: WordCountMeterProps) {
  const { t } = useTranslation()
  const text = useSyncExternalStore(store.subscribe, store.get, store.get)
  const count = countWords(text)
  const belowMin = count < min
  const delta = Math.abs(count - min)

  return (
    <span
      data-testid="writing-word-count"
      data-count={count}
      data-below-min={belowMin}
      className="inline-flex items-center gap-1.5 text-xs text-foreground"
    >
      <span data-testid="writing-word-count-value" className="tabular-nums font-medium">
        {t('writing.wordCount.countMin', { n: count, min })}
      </span>
      <span
        data-testid="writing-word-count-delta"
        className={cn(
          'tabular-nums',
          belowMin ? 'text-[color:var(--cl-amber)]' : 'text-[color:var(--cl-green)]',
        )}
      >
        {belowMin
          ? t('writing.wordCount.belowMin', { n: delta })
          : t('writing.wordCount.aboveMin', { n: delta })}
      </span>
    </span>
  )
}
