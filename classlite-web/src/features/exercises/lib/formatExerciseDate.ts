/**
 * formatExerciseDate — Story 4.1 (TS-6, code-review CR-4-1-18). Localizes the
 * "Last modified" cell. `updatedAt` is a full RFC3339 timestamp on the wire; we
 * take the date-only portion and format it via `Intl.DateTimeFormat` pinned to
 * LOCAL midnight (never `new Date(iso)` UTC parsing in a render path, which
 * flips the date boundary ~7h early in Asia/Ho_Chi_Minh, UTC+7). Falls back to
 * the raw date slice when unparseable.
 *
 * Mirrors `features/classes/lib/formatClassDate` — a shared cross-feature date
 * formatter is tech-debt (FU-3-2-x); TS-7 forbids importing the classes one, so
 * this is a feature-local copy until that extraction lands.
 */
export function formatExerciseDate(iso: string, locale: string): string {
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
