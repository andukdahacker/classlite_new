/**
 * Client-side contract for Knowledge Hub uploads + folder/file forms (Story
 * 4.4b). Hand-written Zod (project-context TS-2 — Zod is NOT codegen'd for this
 * feature; form types infer from the schema, never from the generated API
 * types). The size caps + MIME map MIRROR the server allowlist exactly
 * (`upload_allowlist.go` + `size_caps.go`) so the AC4b "same-copy" contract
 * holds: a client-side reject and a server-side reject show the identical
 * `FILE_TOO_LARGE` message with the identical cap.
 */
import { z } from 'zod'

/** The R2 object-key feature segment for Knowledge Hub uploads. */
export const KNOWLEDGE_FEATURE = 'knowledge' as const

const MiB = 1024 * 1024

// A9 per-file caps — MiB, mirroring internal/service/size_caps.go. Named
// constants (project-context CQ-3); the MB figure shown to the user is derived
// from these so the copy can never drift from the enforced ceiling.
export const KNOWLEDGE_PDF_MAX_BYTES = 50 * MiB
export const KNOWLEDGE_IMAGE_MAX_BYTES = 15 * MiB
export const KNOWLEDGE_AUDIO_MAX_BYTES = 100 * MiB

/** Max folder/file display-name length — mirrors the server 200-rune rule. */
export const KNOWLEDGE_NAME_MAX_LENGTH = 200

/**
 * Accepted extension → locked Content-Type. Mirrors `AllowedExtensions` in
 * upload_allowlist.go (knowledge subset). The Content-Type is locked into the
 * presigned PUT (SEC-8), so it must match the server's expectation byte-for-byte
 * or presign 422s.
 */
export const KNOWLEDGE_CONTENT_TYPE_BY_EXT: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.webm': 'audio/webm',
}

/** Per-extension byte cap. Mirrors `uploadSizeCaps` in size_caps.go. */
const KNOWLEDGE_MAX_BYTES_BY_EXT: Record<string, number> = {
  '.pdf': KNOWLEDGE_PDF_MAX_BYTES,
  '.png': KNOWLEDGE_IMAGE_MAX_BYTES,
  '.jpg': KNOWLEDGE_IMAGE_MAX_BYTES,
  '.jpeg': KNOWLEDGE_IMAGE_MAX_BYTES,
  '.svg': KNOWLEDGE_IMAGE_MAX_BYTES,
  '.mp3': KNOWLEDGE_AUDIO_MAX_BYTES,
  '.wav': KNOWLEDGE_AUDIO_MAX_BYTES,
  '.webm': KNOWLEDGE_AUDIO_MAX_BYTES,
}

/** Every extension a teacher can pick in the Knowledge Hub upload dialog. */
export const KNOWLEDGE_ACCEPTED_EXTENSIONS = Object.keys(
  KNOWLEDGE_CONTENT_TYPE_BY_EXT,
) as readonly string[]

/**
 * The `accept` attribute for the hidden `<input type="file">`. Extensions plus
 * their MIME types so the OS picker filters correctly on both macOS (MIME) and
 * Windows (extension).
 */
export const KNOWLEDGE_ACCEPT_ATTR = [
  ...KNOWLEDGE_ACCEPTED_EXTENSIONS,
  ...Array.from(new Set(Object.values(KNOWLEDGE_CONTENT_TYPE_BY_EXT))),
].join(',')

/** Extracts the lowercased extension (incl. leading dot) from a filename, or "". */
export function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot === -1 ? '' : filename.slice(dot).toLowerCase()
}

/** True when the filename's extension is on the Knowledge Hub allowlist. */
export function isAcceptedKnowledgeFile(filename: string): boolean {
  return extensionOf(filename) in KNOWLEDGE_CONTENT_TYPE_BY_EXT
}

/** The locked Content-Type for a filename, or "" when the type is not allowed. */
export function contentTypeForKnowledgeFile(filename: string): string {
  return KNOWLEDGE_CONTENT_TYPE_BY_EXT[extensionOf(filename)] ?? ''
}

/** The per-file byte cap for a filename's extension, or null when not allowed. */
export function maxBytesForKnowledgeFile(filename: string): number | null {
  return KNOWLEDGE_MAX_BYTES_BY_EXT[extensionOf(filename)] ?? null
}

/** The cap in whole MB (for interpolation into the FILE_TOO_LARGE copy). */
export function capMegabytes(capBytes: number): number {
  return Math.round(capBytes / MiB)
}

/**
 * The distinct outcomes of the client-side pre-upload gate. `too-large` and
 * `wrong-type` map to i18n keys; the caller decides the copy so both locales
 * stay covered (TEST-FE-4). `too-large` carries the cap so the message reads the
 * same as the server's `FILE_TOO_LARGE`.
 */
export type FilePrecheckResult =
  | { ok: true }
  | { ok: false; reason: 'wrong-type' }
  | { ok: false; reason: 'too-large'; capMb: number }

/**
 * precheckKnowledgeFile is the A9 layer-1 client gate: reject a wrong-type or
 * over-cap file BEFORE a presigned PUT is even requested. Server layers 2/4
 * remain authoritative (a determined client can bypass this), but the honest
 * path never streams a doomed upload.
 */
export function precheckKnowledgeFile(file: File): FilePrecheckResult {
  if (!isAcceptedKnowledgeFile(file.name)) {
    return { ok: false, reason: 'wrong-type' }
  }
  const cap = maxBytesForKnowledgeFile(file.name)
  if (cap !== null && file.size > cap) {
    return { ok: false, reason: 'too-large', capMb: capMegabytes(cap) }
  }
  return { ok: true }
}

/** Folder name form schema (create/rename). Messages are i18n keys (TEST-FE-4). */
export const folderNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'knowledgeHub.folder.errors.nameRequired' })
    .max(KNOWLEDGE_NAME_MAX_LENGTH, {
      message: 'knowledgeHub.folder.errors.nameTooLong',
    }),
})
export type FolderNameInput = z.infer<typeof folderNameSchema>

/** File rename form schema. Same shape/rules as folders. */
export const fileNameSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'knowledgeHub.file.errors.nameRequired' })
    .max(KNOWLEDGE_NAME_MAX_LENGTH, {
      message: 'knowledgeHub.file.errors.nameTooLong',
    }),
})
export type FileNameInput = z.infer<typeof fileNameSchema>
