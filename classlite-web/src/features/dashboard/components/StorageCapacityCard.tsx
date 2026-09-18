/**
 * StorageCapacityCard — the owner storage-capacity meter (Story 8-1b, D7).
 * Adapts the `LoadMeter` visual (a mini fill track) to the storage domain: the
 * headline is `Math.round(percentUsed*100)%` — `percentUsed` is a 0..1 FRACTION
 * on the wire (0.6 → "60%"), NEVER rendered raw — plus human-readable bytes via
 * `formatBytes`. The bar turns amber ONLY when the server sets `approaching`
 * (`percentUsed >= threshold`); the client computes no threshold. `data-
 * approaching` mirrors the server flag for tests + future styling.
 *
 * Storage-% ONLY (D-CAP): plan-tier / seat capacity is NOT here → FU-8-1-A.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'
import { formatBytes } from '@/lib/formatBytes'

type DashboardCapacity = components['schemas']['DashboardCapacity']

const FULL_PERCENT = 100

export interface StorageCapacityCardProps {
  capacity: DashboardCapacity
}

export function StorageCapacityCard({
  capacity,
}: StorageCapacityCardProps): ReactElement {
  const { t } = useTranslation()
  // Guard a non-finite wire value (NaN/Infinity) → 0 rather than rendering "NaN%".
  // The headline keeps the TRUE percent (may exceed 100 when over quota — the owner
  // should see that), while the bar width AND aria-valuenow clamp to [0,100] so the
  // meter and the ARIA value stay within their declared min/max.
  const percent = Number.isFinite(capacity.percentUsed)
    ? Math.round(capacity.percentUsed * FULL_PERCENT)
    : 0
  const barWidth = Math.min(FULL_PERCENT, Math.max(0, percent))

  return (
    <div
      data-testid="storage-capacity-meter"
      data-approaching={String(capacity.approaching)}
      className="flex flex-col gap-1.5 rounded-lg border border-[var(--cl-border)] p-3"
    >
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium text-[var(--cl-ink)]">
          {t('dashboard.capacity.label')}
        </span>
        <span
          className={`font-mono text-sm ${
            capacity.approaching
              ? 'text-[var(--cl-amber)]'
              : 'text-[var(--cl-ink)]'
          }`}
        >
          {percent}%
        </span>
      </div>
      <span
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={FULL_PERCENT}
        aria-valuenow={barWidth}
        aria-label={t('dashboard.capacity.label')}
        className="relative block h-1.5 w-full overflow-hidden rounded-full bg-slate-200"
      >
        <span
          className={`block h-full rounded-full ${
            capacity.approaching
              ? 'bg-[var(--cl-amber)]'
              : 'bg-[var(--cl-accent)]'
          }`}
          style={{ width: `${barWidth}%` }}
        />
      </span>
      <span className="text-xs text-[var(--cl-ink-soft)]">
        {t('dashboard.capacity.usage', {
          used: formatBytes(capacity.storageUsedBytes),
          limit: formatBytes(capacity.storageLimitBytes),
        })}
      </span>
    </div>
  )
}
