import { useTranslation } from 'react-i18next'

/**
 * PageHead — `s06` page header (Fraunces H1 + count + sub-line).
 *
 * Display headlines use Fraunces via the `font-heading` Tailwind utility
 * (token bridge `--font-heading` → `--cl-font-display`). First component
 * in the dashboard to render Fraunces — primitives don't consume it.
 *
 * Route-change announcement (1d-3 review D5): the H1 is `tabIndex={-1}`
 * so route-layer consumers can `.focus()` it after navigation. There is
 * NO `aria-live` on the H1 — that would double-announce alongside the
 * focus move. Single source: focus move = announcement. The mobile tab
 * bar's internal `useEffect` on `location.pathname` is the canonical
 * focus consumer; future desktop nav stories should match the pattern.
 *
 * The three-state stories (Default / Loading / Empty / Error) cover the
 * VISUAL SHAPE of those states for design review. The loading-state
 * correctness of any consumer fetch is verified at the CONSUMER story
 * (Epic 2+) — no MSW handler here by design.
 */
export interface PageHeadProps {
  /** i18n key for the H1. */
  titleKey: string
  /** Optional count rendered next to title (`5 classes`). Non-finite or negative values are dropped. */
  count?: number
  /** Optional i18n key for the sub-line. */
  subKey?: string
}

export function PageHead({ titleKey, count, subKey }: PageHeadProps) {
  const { t, i18n } = useTranslation()
  const hasCount =
    typeof count === 'number' && Number.isFinite(count) && count >= 0
  const formattedCount = hasCount
    ? new Intl.NumberFormat(i18n.language).format(count as number)
    : null
  return (
    <header className="flex flex-col gap-1 pb-4" data-testid="page-head">
      <div className="flex items-baseline gap-3">
        <h1
          tabIndex={-1}
          className="font-heading text-2xl text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t(titleKey)}
        </h1>
        {formattedCount !== null ? (
          <span className="font-mono text-sm text-muted-foreground">{formattedCount}</span>
        ) : null}
      </div>
      {subKey ? (
        <p className="text-sm text-muted-foreground">{t(subKey)}</p>
      ) : null}
    </header>
  )
}
