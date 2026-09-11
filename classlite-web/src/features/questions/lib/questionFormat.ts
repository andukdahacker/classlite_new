/**
 * questionFormat — the i18n formatting layer for Q&A timestamps (Story 7.4b).
 * TS-6 keeps dates as ISO strings until a formatter; this IS that formatter (a
 * pure, isolated function given an ISO string + a resolved locale — never an
 * inline `new Date()` in a render path). Produces a locale-aware absolute
 * timestamp for the reply "author + time" line (AC4).
 */
export function formatQuestionTimestamp(iso: string, language: string): string {
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return iso
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(parsed)
}
