import { useTranslation } from 'react-i18next'

/**
 * SearchPill — `s06` topbar search affordance.
 *
 * Visual-only pill with placeholder + ⌘K kbd hint chip. Click forwards to
 * `onActivate` (the eventual ⌘K palette wiring lives in a follow-up story
 * consuming 1d-2's `Command` primitive). 1d-3 ships the affordance only.
 */
export interface SearchPillProps {
  /** i18n key for placeholder text. */
  placeholderKey: string
  /** Triggered on click. Palette UI wiring lives in a future story. */
  onActivate?: () => void
}

export function SearchPill({ placeholderKey, onActivate }: SearchPillProps) {
  const { t } = useTranslation()
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
        {t('topbar.search.hint')}
      </kbd>
    </button>
  )
}
