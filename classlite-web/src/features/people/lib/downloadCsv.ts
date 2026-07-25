/**
 * downloadCsv — client-side CSV blob download for the bulk-import error report
 * (Story 2.7 AC5). Serializes the failed rows to CSV, wraps them in a Blob, and
 * triggers a synthetic `<a download>` click, revoking the object URL after.
 *
 * The error report is the v1 remedy for skipped rows (inline row editing is a
 * deliberate fast-follow deferral).
 */

/** A single cell is escaped per RFC 4180 (quote + double inner quotes) when it
 * contains a comma, quote, or newline. A leading `= + - @` (or tab/CR) is first
 * neutralized with a `'` prefix so a spreadsheet opens the cell as text, not a
 * live formula — the error-report rows contain attacker-controlled emails
 * (CSV formula injection, Story 2.7 code review). */
function escapeCsvCell(value: string): string {
  let cell = value
  if (/^[=+\-@\t\r]/.test(cell)) {
    cell = `'${cell}`
  }
  if (/[",\r\n]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

/** serializeCsv joins a header + rows into an RFC 4180 CSV string. */
export function serializeCsv(header: readonly string[], rows: readonly string[][]): string {
  const lines = [header, ...rows].map((cells) => cells.map(escapeCsvCell).join(','))
  return lines.join('\r\n')
}

/**
 * downloadCsv triggers a browser download of `content` under `filename`. Split
 * from serializeCsv so the serialization is unit-testable without a DOM.
 */
export function downloadCsv(filename: string, content: string): void {
  // Prepend a UTF-8 BOM so Excel (esp. on Windows) decodes non-ASCII cells —
  // Vietnamese names/emails — correctly instead of mojibaking them.
  const blob = new Blob(['\uFEFF', content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  // Defer revocation: revoking on the same tick as click() can cancel the
  // in-flight download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 0)
}
