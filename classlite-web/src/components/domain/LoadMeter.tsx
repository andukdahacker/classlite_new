/**
 * LoadMeter — Story 7.1b (D8). A compact teaching-load bar: a mini fill track
 * plus an `N/cap` label (e.g. "7/10"). The fill turns amber ONLY when the
 * server flags the member as heavy — the client computes NO threshold. The
 * heavy determination (`nextSevenDaysSessionCount >= 8`) is owned entirely by
 * the 7-1a backend (`StaffLoad.heavy`); the FE reflects the flag verbatim so
 * the "when is a teacher overloaded?" policy never forks across services.
 *
 * `data-heavy` mirrors the flag so tests (and future analytics styling) can key
 * off it without re-deriving the threshold. Reused on the s39 roster rows and
 * the s40 Overview tab. Domain tier — no feature imports (FW-7).
 *
 * The fill width is a genuinely-dynamic percentage, so it uses an inline
 * `style` width exactly like the shipped colored-tile precedent
 * (`ClassesPage`/`ClassDetailLayout` set `style={{ backgroundColor }}`) — the
 * one accepted escape from the Tailwind-only rule for data-driven values.
 */
import type { ReactElement } from 'react'

export interface LoadMeterProps {
  /** Sessions in the sliding next-7-days window (StaffLoad.nextSevenDaysSessionCount). */
  value: number
  /** Fixed weekly capacity constant (StaffLoad.weeklyCapacity). */
  capacity: number
  /** Server-owned heavy flag (StaffLoad.heavy) — drives amber, never a client rule. */
  heavy: boolean
}

const FULL_PERCENT = 100

export function LoadMeter({ value, capacity, heavy }: LoadMeterProps): ReactElement {
  const pct =
    capacity > 0
      ? Math.min(FULL_PERCENT, Math.round((value / capacity) * FULL_PERCENT))
      : 0
  const label = `${value}/${capacity}`

  return (
    <span
      className="inline-flex items-center gap-2"
      data-testid="load-meter"
      data-heavy={String(heavy)}
    >
      <span
        className="relative block h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={capacity}
        aria-valuenow={value}
        aria-label={label}
      >
        <span
          className={`block h-full rounded-full ${
            heavy
              ? 'bg-[color:var(--cl-amber)]'
              : 'bg-[color:var(--cl-accent)]'
          }`}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="font-mono text-xs text-slate-600">{label}</span>
    </span>
  )
}
