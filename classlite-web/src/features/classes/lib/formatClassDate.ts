/**
 * formatClassDate — Story 3.2 (TS-6). Localizes date-only wire strings
 * (`YYYY-MM-DD`) via `Intl.DateTimeFormat` pinned to LOCAL midnight, mirroring
 * the settings 2-5b `formatDateSingle`/`formatDateRange` precedent. Dates stay
 * ISO on the wire and are formatted only at render — never `new Date(iso)` UTC
 * parsing in a render path (which flips date boundaries ~7h early in
 * Asia/Ho_Chi_Minh, UTC+7). Falls back to the raw wire string when unparseable.
 *
 * A shared class-date/settings-date extraction is tech-debt (FU-3-2-x) — the
 * two live in separate feature directories today (FW-7 / TS-7 boundary).
 */

function parseIsoDateLocal(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!match) return null
  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
}

/** Formats a single date-only wire string, or returns `iso` verbatim. */
export function formatClassDate(iso: string, locale: string): string {
  const date = parseIsoDateLocal(iso)
  if (!date) return iso
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}

/**
 * Formats a start/end range. When only `start` exists, returns the single
 * formatted start date; when neither exists, returns `null` so the caller can
 * render its own "no schedule" copy.
 */
export function formatClassDateRange(
  start: string | null,
  end: string | null,
  locale: string,
): string | null {
  if (!start && !end) return null
  if (start && !end) return formatClassDate(start, locale)
  if (!start && end) return formatClassDate(end, locale)
  return `${formatClassDate(start as string, locale)} — ${formatClassDate(
    end as string,
    locale,
  )}`
}
