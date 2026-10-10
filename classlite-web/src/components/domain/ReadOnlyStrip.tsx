/**
 * ReadOnlyStrip — the canonical "this is locked, here's why, here's what to do"
 * strip (Story 10.4 AC7, s66; component-inventory domain/M3). Built for the
 * finalized-exercise lock: a "Locked" indicator + the three-part explainer
 * (what: locked · why: has submissions / grades finalized · what-to-do: clone)
 * and a single recovery action slot (the Clone CTA).
 *
 * DUMB leaf (mirrors `ErrorState`/`EmptyState`): it NEVER calls `t()` — every
 * string arrives i18n-resolved — and NEVER reads role. The lock glyph is
 * decorative (`aria-hidden`). It is an informational state, not an error, so it
 * uses the neutral amber idiom (not the red error idiom) and no `role="alert"`.
 */
import type { ReactElement, ReactNode } from 'react'
import { Lock } from 'lucide-react'

export interface ReadOnlyStripProps {
  /** i18n-RESOLVED short "Locked" indicator label. */
  indicator: string
  /** i18n-RESOLVED "what happened" heading. */
  title: string
  /** i18n-RESOLVED "why + what-to-do" body (the three-part middle + next step). */
  body: string
  /** The sanctioned recovery action (e.g. the Clone button). */
  action?: ReactNode
  'data-testid'?: string
}

export function ReadOnlyStrip({
  indicator,
  title,
  body,
  action,
  'data-testid': dataTestId,
}: ReadOnlyStripProps): ReactElement {
  return (
    <div
      data-testid={dataTestId}
      className="flex flex-col gap-3 rounded-md border border-[var(--cl-amber)] bg-[var(--cl-amber)]/10 px-4 py-3 text-sm text-[var(--cl-ink)]"
    >
      <span className="inline-flex w-fit items-center gap-1.5 rounded-full bg-[var(--cl-amber)]/20 px-2 py-0.5 text-xs font-medium text-[var(--cl-ink)]">
        <Lock aria-hidden="true" className="size-3.5" />
        {indicator}
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="font-medium text-[color:var(--cl-ink)]">{title}</h2>
        <p className="text-[color:var(--cl-ink-soft)]">{body}</p>
      </div>
      {action ? <div className="flex flex-wrap items-center gap-2">{action}</div> : null}
    </div>
  )
}
