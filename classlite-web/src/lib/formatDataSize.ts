/**
 * formatDataSize — render a byte count as a locale-formatted decimal-unit size
 * string (e.g. `44.7 GB`, `500 MB`). Story 9-1b, AC21 (the `PlanUsageMeter`
 * bytes variant).
 *
 * Lives in `lib/` (not a feature) so the domain-tier `PlanUsageMeter` can use
 * it without a feature-boundary import (TS-7). It mirrors the knowledge-hub
 * `formatFileSize` algorithm — decimal `GB`/`MB` unit symbols (universal across
 * en/vi) with a locale-formatted number — rather than `lib/formatBytes`, whose
 * IEC `GiB` symbols are for the owner storage-capacity meter. The unit symbol
 * is locale-neutral (a `GB` reads the same in both), the NUMBER is localized.
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const
const BYTES_PER_UNIT = 1024
const ONE_DECIMAL_FROM_UNIT_INDEX = 2 // MB and above show one decimal place

/** formatDataSize converts `bytes` to a compact, locale-aware `N UNIT` string. */
export function formatDataSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return `0 ${UNITS[0]}`
  // Divide iteratively rather than via `Math.log`: float log/log-division
  // mis-buckets exact powers of 1024 (e.g. 1 GB flooring to 1023.99… MB) and can
  // yield a negative exponent for 0 < bytes < 1 (→ UNITS[-1] = undefined).
  let exponent = 0
  let value = bytes
  while (value >= BYTES_PER_UNIT && exponent < UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    exponent += 1
  }
  const maximumFractionDigits = exponent >= ONE_DECIMAL_FROM_UNIT_INDEX ? 1 : 0
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value)
  return `${formatted} ${UNITS[exponent]}`
}
