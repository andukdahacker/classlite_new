import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * AnchoredQuestionsRailShell — `s18`/`s36` layout-only rail container (Story
 * 1d-4 inventory; used by the 7.4b teacher console). A sticky rail head (title +
 * open-count + a filter slot) over an inner card stack. PRESENTATIONAL and
 * business-light: it owns no data and no mutations — the console feeds the count,
 * the filter control, the batch bar, and the card children (which carry the
 * UX-1 loading/empty/error states).
 */
export interface AnchoredQuestionsRailShellProps {
  title: string
  /** Open (unanswered) count shown in the head. */
  count: number
  /** Filter control (e.g. the "Unanswered" toggle) rendered in the head. */
  filter?: ReactNode
  /** Batch action strip, rendered above the stack when a selection is active. */
  batchBar?: ReactNode
  children: ReactNode
}

export function AnchoredQuestionsRailShell({
  title,
  count,
  filter,
  batchBar,
  children,
}: AnchoredQuestionsRailShellProps) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="anchored-questions-rail"
      className="flex flex-col gap-4"
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h1 className="text-lg font-[var(--cl-font-display)] text-foreground">{title}</h1>
          <span
            data-testid="anchored-questions-rail-count"
            className="inline-flex min-w-6 items-center justify-center rounded-full bg-[color:var(--cl-tint-gold)] px-2 py-0.5 text-xs font-medium text-[color:var(--cl-amber)]"
          >
            {t('questions.console.openCount', { count })}
          </span>
        </div>
        {filter ? <div className="flex items-center gap-2">{filter}</div> : null}
      </header>
      {batchBar}
      <div className="flex flex-col gap-3">{children}</div>
    </section>
  )
}
