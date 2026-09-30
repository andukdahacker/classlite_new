/**
 * PlanUsageMeter — Story 9-1b (AC21, the reserved-name meter). ONE polymorphic
 * usage meter for the billing dashboard's four meters (teacher seats, classes,
 * AI credits, storage) — never three near-duplicate components.
 *
 * It renders the server contract VERBATIM and re-derives no thresholds: the
 * amber `.warn` state is driven by the `warn` prop (the server's `approaching`
 * boolean, D22), exactly the way `LoadMeter` reflects the server-owned `heavy`
 * flag. `data-warn` mirrors `warn` so tests (and future analytics styling) key
 * off it without re-computing a rule.
 *
 * Variant contract:
 *   - `unit:'credits'`→ a distinct "N credits remaining" read-out plus a
 *     formatted `resetAt` line. Credits report a REMAINING balance, so they are
 *     deliberately NOT rendered as a fill-toward-max bar (that would empty as
 *     credits deplete and read as consumption — the inverse of the count/bytes
 *     meters); no client-derived low-balance threshold (D22 — server owns flags).
 *   - `max === null` → the tier is unlimited: render "Unlimited", NO progress
 *     bar, NO `aria-valuemax`, and `.warn` is SUPPRESSED regardless of `warn`
 *     (an unlimited meter can never be "approaching" — a defensive guard
 *     against a server contract slip, AC8/H).
 *   - `unit:'count'`  → `value / max` ratio with a fill-toward-max bar.
 *   - `unit:'bytes'`  → human-readable sizes via `lib/formatDataSize` (GB/MB).
 *
 * The count/bytes bar is HAND-ROLLED (a `<span role="progressbar">`), not a wrap
 * of `ui/progress.tsx`: the unlimited/credits variants and the server-driven
 * `.warn` state need presentation the primitive does not express, so wrapping it
 * would be a thin shell around a div anyway. Deviation from the AC21 "wraps the
 * primitive" wording is recorded in the story (Review-Findings P9). The fill
 * width is a genuinely dynamic percentage, so it uses an inline `style` width
 * like the shipped `LoadMeter` / `StorageTab` precedent (the one accepted escape
 * from the Tailwind-only rule for data-driven values). Domain tier — no feature
 * imports (FW-7). `aria-valuenow` is clamped into `[0, max]` and the fill percent
 * into `[0, 100]` so an over-limit or `max===0` server state stays valid ARIA.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatDataSize } from '@/lib/formatDataSize'

export type PlanUsageMeterUnit = 'count' | 'bytes' | 'credits'

export interface PlanUsageMeterProps {
  /** What the value/max are counted in — drives the read-out formatting. */
  unit: PlanUsageMeterUnit
  /** Current usage (count / used bytes / available credits). */
  value: number
  /** The ceiling; `null` means unlimited (no bar, no ratio). */
  max: number | null
  /** Server `approaching` flag — drives amber. Suppressed when `max === null`. */
  warn: boolean
  /** ISO reset instant for `unit:'credits'` (rendered via the i18n formatter). */
  resetAt?: string
  /** Optional label rendered above the bar and used as the progressbar's name. */
  label?: string
  /** Suffix for `data-testid` → `plan-usage-meter-{testKey}` (the consumer keys meters). */
  testKey?: string
}

const FULL_PERCENT = 100

export function PlanUsageMeter({
  unit,
  value,
  max,
  warn,
  resetAt,
  label,
  testKey,
}: PlanUsageMeterProps): ReactElement {
  const { t, i18n } = useTranslation()
  const testId = testKey ? `plan-usage-meter-${testKey}` : 'plan-usage-meter'

  // Credits report a REMAINING balance — a distinct read-out, never a
  // fill-toward-max bar (Decision 1 / Review-Findings P8).
  if (unit === 'credits') {
    return (
      <div data-testid={testId} data-warn="false" className="flex flex-col gap-1">
        {label ? (
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {label}
          </span>
        ) : null}
        <span className="text-sm text-slate-700 tabular-nums">
          {t('billing.meter.creditsRemaining', { value })}
        </span>
        {resetAt ? (
          <span className="text-xs text-slate-500">
            {t('billing.meter.resetAt', { val: resetAt })}
          </span>
        ) : null}
      </div>
    )
  }

  const unlimited = max === null
  const effectiveWarn = unlimited ? false : warn

  if (unlimited) {
    return (
      <div
        data-testid={testId}
        data-warn={String(effectiveWarn)}
        className="flex flex-col gap-1"
      >
        {label ? (
          <span className="text-xs uppercase tracking-wide text-slate-400">
            {label}
          </span>
        ) : null}
        <span className="text-sm text-slate-700">
          {t('billing.meter.unlimited')}
        </span>
      </div>
    )
  }

  const readout =
    unit === 'bytes'
      ? `${formatDataSize(value, i18n.language)} / ${formatDataSize(max, i18n.language)}`
      : `${value} / ${max}`
  const percent =
    max > 0
      ? Math.min(FULL_PERCENT, Math.max(0, Math.round((value / max) * FULL_PERCENT)))
      : 0
  // Clamp the reported value into [0, max] so an over-limit or max===0 server
  // state never emits invalid ARIA (aria-valuenow outside [valuemin, valuemax]).
  const ariaNow = Math.min(max, Math.max(0, value))

  return (
    <div
      data-testid={testId}
      data-warn={String(effectiveWarn)}
      className="flex flex-col gap-1"
    >
      {label ? (
        <span className="text-xs uppercase tracking-wide text-slate-400">
          {label}
        </span>
      ) : null}
      <span className="text-sm text-slate-700 tabular-nums">{readout}</span>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={ariaNow}
        aria-label={label ?? readout}
        data-warn={String(effectiveWarn)}
        className="relative block h-2 w-full overflow-hidden rounded-full bg-slate-100"
      >
        <span
          className={`block h-full rounded-full ${
            effectiveWarn
              ? 'bg-[color:var(--cl-amber)]'
              : 'bg-[color:var(--cl-accent)]'
          }`}
          style={{ width: `${percent}%` }}
        />
      </span>
    </div>
  )
}
