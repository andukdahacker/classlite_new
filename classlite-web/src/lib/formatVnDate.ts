/**
 * formatVnDate — render an ISO date-time as a short `dd/MM/yyyy` date in the
 * center's Vietnam-local wall clock (Story 9-1b, AC10 / TS-6).
 *
 * Wired into the i18n interpolation layer (`lib/i18n.ts`, the `vnDate` format
 * token) so components pass the RAW ISO string to `t(...)` and the i18n layer
 * owns the formatting — never `new Date().toLocaleDateString()` in a render
 * path. Values like billing `resetAt` are already VN-local midnight with a
 * `+07:00` offset; formatting in the VN timezone renders that wall clock
 * as-is (no shift). A malformed value returns unchanged so a bad wire string
 * never renders `Invalid Date`.
 */
const VN_TIMEZONE = 'Asia/Ho_Chi_Minh'

/** formatVnDate formats an ISO string as `dd/MM/yyyy` in VN-local time. */
export function formatVnDate(iso: string, locale: string): string {
  const parsedMs = Date.parse(iso)
  if (Number.isNaN(parsedMs)) return iso
  return new Intl.DateTimeFormat(locale === 'vi' ? 'vi-VN' : 'en-GB', {
    timeZone: VN_TIMEZONE,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(parsedMs)
}
