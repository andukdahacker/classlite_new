import { useTranslation } from 'react-i18next'
import { isMacPlatform } from '@/lib/platform'

/**
 * SearchPill — `s06` topbar search affordance.
 *
 * Visual pill with placeholder + a platform-aware ⌘K/Ctrl K kbd hint chip. Click
 * forwards to `onActivate`, which Story 8-4b wires to the ⌘K command palette
 * (`useCommandPalette().openPalette`). The glyph is chosen ONCE at render from
 * `isMacPlatform()` (D6, capped: one platform read → one glyph, no per-OS icon
 * sets) and rendered via i18n keys inside a real `<kbd>`.
 */
export interface SearchPillProps {
  /** i18n key for placeholder text. */
  placeholderKey: string
  /** Triggered on click — opens the ⌘K command palette (Story 8-4b). */
  onActivate?: () => void
}

export function SearchPill({ placeholderKey, onActivate }: SearchPillProps) {
  const { t } = useTranslation()
  // One platform read → one glyph (D6). ⌘K on Mac, Ctrl K everywhere else.
  const hintKey = isMacPlatform() ? 'search.hint.mac' : 'search.hint.other'
  // No `aria-label` — the visible placeholder text is the accessible name.
  // The kbd hint is `aria-hidden` so it doesn't duplicate audibly.
  return (
    <button
      type="button"
      onClick={onActivate}
      data-testid="search-pill"
      className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <span>{t(placeholderKey)}</span>
      <kbd
        aria-hidden="true"
        className="inline-flex items-center rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground"
      >
        {t(hintKey)}
      </kbd>
    </button>
  )
}
