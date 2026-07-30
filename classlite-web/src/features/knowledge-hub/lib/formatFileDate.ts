/**
 * formatFileDate — localizes a file's upload date for the detail metadata
 * (Story 4.4b, AC5 / TS-6). Same local-midnight approach as
 * `features/exercises/lib/formatExerciseDate`: parse the date-only slice and
 * format via `Intl.DateTimeFormat`, never `new Date(iso)` in a render path
 * (UTC parsing flips the boundary ~7h early in Asia/Ho_Chi_Minh, UTC+7). A
 * shared cross-feature date formatter is tech-debt; TS-7 forbids reaching into
 * the exercises copy, so this is a feature-local duplicate until that lands.
 */
export function formatFileDate(iso: string, locale: string): string {
  const datePart = iso.slice(0, 10)
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datePart)
  if (!match) return datePart
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]))
  return new Intl.DateTimeFormat(locale, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  }).format(date)
}
