/**
 * formatFileSize — render a byte count as a locale-formatted "N UNIT" string
 * (Story 4.4b, file tiles + detail metadata + storage meter). The UNIT symbols
 * (KB/MB/GB) are universal across en/vi, but the NUMBER is localized via
 * `Intl.NumberFormat` so Vietnamese gets its comma decimal separator (AC8
 * interpolated-number review). Not a date, so this is exempt from the TS-6
 * i18n-date rule; there is no ambiguity to defer to a formatter.
 */
const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/** formatFileSize converts `bytes` to a compact, locale-aware size string. */
export function formatFileSize(bytes: number, locale: string): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return `0 ${UNITS[0]}`
  }
  const exponent = Math.min(
    UNITS.length - 1,
    Math.floor(Math.log(bytes) / Math.log(1024)),
  )
  const value = bytes / 1024 ** exponent
  // 0 decimals for bytes/KB (whole units read cleaner); 1 decimal from MB up.
  const maximumFractionDigits = exponent < 2 ? 0 : 1
  const formatted = new Intl.NumberFormat(locale, {
    maximumFractionDigits,
  }).format(value)
  return `${formatted} ${UNITS[exponent]}`
}

/**
 * storagePercent returns the used fraction as a 0–100 integer, clamped. Used by
 * the Settings → Storage meter and the upload-seam full check.
 */
export function storagePercent(usedBytes: number, limitBytes: number): number {
  if (limitBytes <= 0) return 100
  return Math.min(100, Math.max(0, Math.round((usedBytes / limitBytes) * 100)))
}

/** True once usage has reached the ceiling (the AC7 100% hard-block trigger). A
 * non-positive limit (unprovisioned/misconfigured) reads as full — matching
 * {@link storagePercent}'s 100% — so the two never disagree. */
export function isStorageFull(usedBytes: number, limitBytes: number): boolean {
  if (limitBytes <= 0) return true
  return usedBytes >= limitBytes
}
