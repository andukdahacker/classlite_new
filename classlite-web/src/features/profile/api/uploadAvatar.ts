/**
 * uploadAvatar — Story 9.4 (AC5) the avatar presign → transfer chain.
 *
 * Flow: client pre-check (≤5 MB, png/jpeg/webp) → POST /api/uploads/presign
 * `feature:"avatars"` → direct XHR PUT to R2 (0..1 progress, cancelable). The
 * returned KEY is then merged into the profile snapshot and persisted via
 * PUT /api/users/me (where the server re-validates size/type via HeadObject,
 * D7, and rewrites the key to a full public URL, D6). We deliberately do NOT
 * reuse `finalizeKnowledgeUpload` (that creates a Hub `files` row) nor
 * `transferToStorage` (its Content-Type is derived from the knowledge
 * allowlist) — the avatar chain locks its own image Content-Type.
 */
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'

type PresignResult = components['schemas']['PresignResult']
type PresignRequest = components['schemas']['PresignRequest']

/** The 5 MB avatar cap (A9 / D3), mirrored client-side for an instant reject. */
export const AVATAR_MAX_BYTES = 5 * 1024 * 1024

/** The allowed avatar extensions → canonical MIME (D8 — SVG excluded). */
const AVATAR_EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

const UPLOAD_TIMEOUT_MS = 60_000

/**
 * AvatarValidationError is a client-side pre-check failure (too large / wrong
 * type) — rejected instantly in-language before any network call. `code` lets
 * the UI pick the right i18n message.
 */
export class AvatarValidationError extends Error {
  readonly code: 'tooLarge' | 'wrongType'
  constructor(code: 'tooLarge' | 'wrongType') {
    super(code)
    this.name = 'AvatarValidationError'
    this.code = code
  }
}

/** AvatarTransferError is a network/non-2xx failure of the direct R2 PUT. */
export class AvatarTransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AvatarTransferError'
  }
}

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.')
  return dot >= 0 ? filename.slice(dot + 1).toLowerCase() : ''
}

/**
 * precheckAvatar validates size + type client-side (AC5), throwing an
 * AvatarValidationError the caller renders in-language. Returns the locked
 * Content-Type on success.
 */
export function precheckAvatar(file: File): string {
  if (file.size > AVATAR_MAX_BYTES) {
    throw new AvatarValidationError('tooLarge')
  }
  const mime = AVATAR_EXT_MIME[extensionOf(file.name)]
  if (!mime) {
    throw new AvatarValidationError('wrongType')
  }
  return mime
}

/** presignAvatar requests a presigned PUT URL for the avatars feature. */
export async function presignAvatar(
  file: File,
  contentType: string,
): Promise<PresignResult> {
  const body: PresignRequest = {
    filename: file.name,
    contentType,
    feature: 'avatars',
    sizeBytes: file.size,
  }
  return apiFetch<PresignResult>('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

/**
 * transferAvatarToStorage streams the file to the presigned URL via XHR with
 * 0..1 progress and abort support. Content-Type is locked to the presigned
 * value (SEC-8). Rejects with AvatarTransferError on network/timeout/non-2xx.
 */
export function transferAvatarToStorage(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new AvatarTransferError('upload aborted'))
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.total > 0 ? event.loaded / event.total : 0)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new AvatarTransferError(`upload failed with status ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new AvatarTransferError('upload network error'))
    xhr.ontimeout = () => reject(new AvatarTransferError('upload timed out'))
    xhr.onabort = () => reject(new AvatarTransferError('upload aborted'))
    xhr.send(file)
  })
}

/**
 * uploadAvatarFile runs the full pre-check → presign → transfer chain and
 * returns the R2 object KEY for the caller to merge into the profile snapshot.
 */
export async function uploadAvatarFile(
  file: File,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const contentType = precheckAvatar(file)
  const { url, key } = await presignAvatar(file, contentType)
  await transferAvatarToStorage(url, file, contentType, onProgress, signal)
  return key
}
