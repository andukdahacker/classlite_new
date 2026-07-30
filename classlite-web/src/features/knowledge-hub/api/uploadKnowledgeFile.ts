/**
 * uploadKnowledgeFile — the three primitives of the Knowledge Hub upload chain
 * (Story 4.4b, AC3/AC4), kept as separate awaitable steps so the UPLOAD DIALOG
 * owns the phase state machine (presign → transfer → finalize) and can surface a
 * DISTINCT human message per stage. Mirrors `people/api/useUploadImportFile.ts`
 * (XHR PUT for progress + `no-restricted-globals` compliance) with the
 * `knowledge` feature and the confirm→create step that mints a `files` row.
 *
 * The three phases and their failure meanings:
 *   1. presign   — server validates type/size/storage BEFORE a byte moves.
 *                  Throws ApiError (413 FILE_TOO_LARGE, 409 STORAGE_FULL, 422).
 *   2. transfer  — the raw PUT to R2. Throws {@link TransferError} (network /
 *                  timeout / non-2xx) — the retryable stage (AC4c).
 *   3. finalize  — /uploads/confirm HeadObject-re-validates + creates the row
 *                  under the per-center storage lock. Throws ApiError
 *                  (413/422/409 STORAGE_FULL/502) — the authoritative gate, so a
 *                  server reject here reuses the SAME copy as the client (AC4b).
 */
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import {
  KNOWLEDGE_FEATURE,
  contentTypeForKnowledgeFile,
} from '../lib/knowledgeHubSchemas'

type PresignResult = components['schemas']['PresignResult']
type PresignRequest = components['schemas']['PresignRequest']
type ConfirmUploadRequest = components['schemas']['ConfirmUploadRequest']
export type FileWire = components['schemas']['File']

/** Abort a stalled PUT so the transfer phase can't hang the dialog forever. */
const UPLOAD_TIMEOUT_MS = 60_000

/**
 * TransferError marks a failure of the raw R2 PUT (network drop, timeout, or a
 * non-2xx from R2) — as opposed to an `ApiError` from our own presign/confirm
 * endpoints. The dialog maps it to the "transfer failed" copy + a Retry that
 * re-runs the chain from presign (AC4c/AC4d: re-PUT from zero, not resumable).
 */
export class TransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransferError'
  }
}

/**
 * presignKnowledgeUpload requests a presigned PUT URL for a knowledge file. The
 * declared `sizeBytes` lets the server reject over-cap (413) or storage-full
 * (409, advisory) before signing.
 */
export async function presignKnowledgeUpload(file: File): Promise<PresignResult> {
  const contentType = contentTypeForKnowledgeFile(file.name)
  const body: PresignRequest = {
    filename: file.name,
    contentType,
    feature: KNOWLEDGE_FEATURE,
    sizeBytes: file.size,
  }
  return apiFetch<PresignResult>('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * transferToStorage streams the file bytes to the presigned URL via XHR,
 * reporting 0..1 progress. The Content-Type is locked to the presigned value
 * (SEC-8). Rejects with a {@link TransferError} on network/timeout/non-2xx.
 */
export function transferToStorage(
  url: string,
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  const contentType = contentTypeForKnowledgeFile(file.name)
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new TransferError('upload aborted'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    // Abort the in-flight PUT when the caller unmounts, so a navigated-away
    // upload can't keep streaming and orphan an R2 object with no files row.
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        // Guard the 0-byte case: event.total is 0, so the ratio is NaN.
        onProgress(event.total > 0 ? event.loaded / event.total : 0)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new TransferError(`upload failed with status ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new TransferError('upload network error'))
    xhr.ontimeout = () => reject(new TransferError('upload timed out'))
    xhr.onabort = () => reject(new TransferError('upload aborted'))
    xhr.send(file)
  })
}

/**
 * finalizeKnowledgeUpload confirms the completed upload and creates the `files`
 * row. This is the authoritative gate (HeadObject re-validate + per-center
 * storage lock), so a rejection here (413/422/409) must be shown with the same
 * copy the client pre-check uses.
 */
export async function finalizeKnowledgeUpload(params: {
  key: string
  name: string | null
  folderId: string | null
  sizeBytes: number
}): Promise<FileWire> {
  const body: ConfirmUploadRequest = {
    key: params.key,
    name: params.name,
    folderId: params.folderId,
    sizeBytes: params.sizeBytes,
  }
  return apiFetch<FileWire>('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}
