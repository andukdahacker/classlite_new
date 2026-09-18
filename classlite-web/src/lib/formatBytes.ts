/**
 * formatBytes — human-readable byte sizes for the owner storage-capacity meter
 * (Story 8-1b D7). Binary units (KiB/MiB/GiB) match how R2/storage quotas are
 * expressed on the wire (`storageLimitBytes` is a power-of-two ceiling).
 *
 * Kept locale-neutral: the numeric value is formatted with a fixed one-decimal
 * for GiB+ and whole numbers below, and the unit is an SI/IEC symbol that reads
 * the same in en + vi — so no i18n key is needed for the unit itself (UX-2 is
 * about user-facing copy; a `GiB` symbol is a unit, not translated prose).
 */
const BYTES_PER_UNIT = 1024
const UNITS = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'] as const
const ONE_DECIMAL_FROM_UNIT_INDEX = 3 // GiB and above show one decimal place

/**
 * Formats a byte count as a compact IEC-unit string (e.g. `3.0 GiB`, `512 MiB`).
 * Negative or non-finite inputs clamp to `0 B` so a bad wire value never renders
 * `NaN`.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  let value = bytes
  let unitIndex = 0
  while (value >= BYTES_PER_UNIT && unitIndex < UNITS.length - 1) {
    value /= BYTES_PER_UNIT
    unitIndex += 1
  }
  const decimals = unitIndex >= ONE_DECIMAL_FROM_UNIT_INDEX ? 1 : 0
  return `${value.toFixed(decimals)} ${UNITS[unitIndex]}`
}
