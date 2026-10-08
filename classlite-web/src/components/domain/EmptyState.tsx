/**
 * EmptyState — the canonical empty-state leaf (Story 10.3, AC1; the 1d-5 AC3
 * design brief deferred into Epic 10). ONE presentational component generalizing
 * the two shipped idioms `InboxEmpty` (`InboxStates.tsx`) and `ArchiveEmpty`
 * (`ArchiveStates.tsx`): a circular muted ghost-icon chip, a Fraunces display
 * headline whose ONE trailing italic word is the §6.4 brand signature
 * (`headlineAccent`), a muted one-liner, and centered actions.
 *
 * It is DUMB on purpose (UX-1 / UX-3 / TEST-FE-4):
 *   - It NEVER calls `t()` — every string arrives already i18n-resolved from the
 *     consumer, so the role-decorator stays at the call site.
 *   - It NEVER reads role.
 *   - The interface is FLAT (no discriminated union on `tone`) — a DU buys ~no
 *     safety on a presentational leaf and fights ergonomics (party-mode, Winston).
 *
 * The `headlineAccent` span is the brand invariant: the italic accent lives ONLY
 * inside this component and is never recomposed at call sites — that single-source
 * guarantee is the whole point of the consolidation.
 */
import type { ReactElement, ReactNode } from 'react'

export type EmptyStateTone = 'simple' | 'guided'

export interface EmptyStateProps {
  /**
   * Ghosted glyph (a lucide icon). OPTIONAL. With `tone='simple'` an omitted
   * icon still renders a bare muted chip (the placeholder idiom); with
   * `tone='guided'` an omitted icon renders no chip at all.
   */
  icon?: ReactNode
  /**
   * i18n-resolved headline. OPTIONAL: required in spirit for `tone='simple'`;
   * omittable for `tone='guided'` where a page-head / warn-banner already
   * carries the message and a second stamped headline would be redundant.
   */
  headline?: string
  /**
   * i18n-resolved. Rendered as a TRAILING italic accent span appended to the
   * headline (§6.4 brand signature). Trailing only — no mid-string accent.
   */
  headlineAccent?: string
  /** i18n-resolved supporting line. */
  description?: string
  /** Zero or more CTAs; renders nothing if absent (e.g. the archive empty). */
  actions?: ReactNode
  /**
   * `'simple'` (default) = ghost-chip + headline idiom. `'guided'` = wider,
   * children-carrying; the chip / headline / accent are suppressed when the
   * consumer omits them, so a day-one or ghosted surface that carries its own
   * message does not get a second headline stamped on top.
   */
  tone?: EmptyStateTone
  /** Guided-only rich content (GhostedChartFrame, warn-banner, hero) below the headline. */
  children?: ReactNode
  /**
   * Async-arrival announcement. Default (`false`) renders a plain container so a
   * first-paint empty is NOT announced as if it just arrived; `true` promotes it
   * to `role="status"` (which implies `aria-live="polite"`) for an empty that
   * materializes after a fetch resolves.
   */
  live?: boolean
  'data-testid'?: string
}

/**
 * EmptyState renders a role-appropriate empty surface. See the module docstring
 * for the contract; all strings must arrive i18n-resolved (the component never
 * calls `t()`).
 */
export function EmptyState({
  icon,
  headline,
  headlineAccent,
  description,
  actions,
  tone = 'simple',
  children,
  live = false,
  'data-testid': dataTestId,
}: EmptyStateProps): ReactElement {
  // simple → always a chip (a bare muted circle when no glyph, per the
  // placeholder idiom). guided → a chip only when a glyph is supplied.
  const showChip = tone === 'simple' || icon != null
  const containerClass =
    tone === 'guided'
      ? 'flex w-full flex-col items-center gap-4 px-6 py-10 text-center'
      : 'flex flex-col items-center gap-3 px-6 py-12 text-center'

  return (
    <div
      {...(live ? { role: 'status' } : {})}
      data-testid={dataTestId}
      className={containerClass}
    >
      {showChip ? (
        <span
          aria-hidden="true"
          className="inline-flex size-14 items-center justify-center rounded-full bg-muted/50 text-[color:var(--cl-muted)]"
        >
          {icon}
        </span>
      ) : null}
      {headline ? (
        <h2 className="font-[var(--cl-font-display)] text-2xl text-[color:var(--cl-ink)]">
          {headline}
          {headlineAccent ? (
            <>
              {' '}
              <span className="italic text-[color:var(--cl-accent)]">
                {headlineAccent}
              </span>
            </>
          ) : null}
        </h2>
      ) : null}
      {description ? (
        <p className="max-w-sm text-sm text-[color:var(--cl-ink-soft)]">
          {description}
        </p>
      ) : null}
      {children}
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {actions}
        </div>
      ) : null}
    </div>
  )
}
