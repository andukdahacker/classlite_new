/**
 * Client-side validation for the bulk-import file picker (Story 2.7). The
 * authoritative parse + row validation is server-side (preview/confirm); this is
 * the cheap pre-upload gate that rejects the wrong file type before a presigned
 * PUT is even requested. Messages are i18n KEYS (resolved at render, TEST-FE-4).
 */
import { z } from 'zod'

/** Accepted spreadsheet extensions (mirrors the API `imports` allowlist). */
export const ACCEPTED_IMPORT_EXTENSIONS = ['.csv', '.xlsx'] as const

/** Max import file size — mirrors the server-side `maxImportFileBytes` (5 MiB)
 * so an oversize file is rejected before a presigned PUT streams it in full. */
export const MAX_IMPORT_FILE_BYTES = 5 * 1024 * 1024

/** The MIME types locked into the presigned PUT, keyed by extension. */
export const IMPORT_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.csv': 'text/csv',
  '.xlsx':
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
}

/** Extracts the lowercased extension (incl. dot) from a filename, or "". */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/** True when the file's extension is one we accept. */
export function isAcceptedImportFile(filename: string): boolean {
  return (ACCEPTED_IMPORT_EXTENSIONS as readonly string[]).includes(
    extensionOf(filename),
  )
}

/**
 * importFileSchema validates a picked File. `message` values are i18n keys the
 * form resolves via `t(...)` so both locales stay covered (UX-2).
 */
export const importFileSchema = z
  .instanceof(File, { message: 'people.import.errors.noFile' })
  .refine((file) => isAcceptedImportFile(file.name), {
    message: 'people.import.errors.wrongType',
  })
  .refine((file) => file.size <= MAX_IMPORT_FILE_BYTES, {
    message: 'people.import.errors.fileTooLarge',
  })

export type ImportFileInput = z.infer<typeof importFileSchema>
