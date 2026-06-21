import { useTranslation } from 'react-i18next'

/**
 * PageHead — `s06` page header (Fraunces H1 + count + sub-line).
 *
 * Display headlines use Fraunces via the `font-heading` Tailwind utility
 * (token bridge `--font-heading` → `--cl-font-display`). First component
 * in the dashboard to render Fraunces — primitives don't consume it.
 *
 * The three-state stories (Default / Loading / Empty / Error) cover the
 * VISUAL SHAPE of those states for design review. The loading-state
 * correctness of any consumer fetch is verified at the CONSUMER story
 * (Epic 2+) — no MSW handler here by design.
 */
export interface PageHeadProps {
  /** i18n key for the H1. */
  titleKey: string
  /** Optional count rendered next to title (`5 classes`). */
  count?: number
  /** Optional i18n key for the sub-line. */
  subKey?: string
}

export function PageHead({ titleKey, count, subKey }: PageHeadProps) {
  const { t } = useTranslation()
  return (
    <header className="flex flex-col gap-1 pb-4" data-testid="page-head">
      <div className="flex items-baseline gap-3">
        <h1
          tabIndex={-1}
          aria-live="polite"
          className="font-heading text-2xl text-foreground"
        >
          {t(titleKey)}
        </h1>
        {typeof count === 'number' ? (
          <span className="font-mono text-sm text-muted-foreground">{count}</span>
        ) : null}
      </div>
      {subKey ? (
        <p className="text-sm text-muted-foreground">{t(subKey)}</p>
      ) : null}
    </header>
  )
}
