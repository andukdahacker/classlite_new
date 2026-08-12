/**
 * uploadSpeakingAudio — Story 5.4 Task 4 (AC12,13,16). A SPEAKING-LOCAL upload
 * trio (`feature: 'speaking'`) that mirrors the pattern of
 * `knowledge-hub/api/uploadKnowledgeFile.ts` + `people/api/useUploadImportFile.ts`
 * WITHOUT importing them (TS-7 feature boundary). The chain is
 * presign → direct R2 PUT (XHR, Content-Type locked, progress, abort) → confirm.
 *
 * Automatic retry (AC13, R43): 1 initial + up to 3 retries = 4 attempts total,
 * re-running from presign each time (the server mints a fresh key per presign, so
 * a superseded take orphans — AC9/FU-4-4-6). Only a transfer-phase failure
 * (`TransferError`) or a 502 is retryable; a 4xx (413 over-cap, 422) is permanent
 * and throws immediately. On total failure the caller keeps the Blob in-memory and
 * surfaces the local-fallback state (D2). An abort during a backoff window fires no
 * further presign / R2 PUT (abort-mid-retry — Murat STRONG).
 */
import { apiFetch, ApiError } from '@/lib/api-fetch'
import {
  SPEAKING_AUDIO_MAX_BYTES,
  type CanonicalAudioMime,
} from '../lib/speakingContent'

/** The object-key feature segment for speaking uploads. */
export const SPEAKING_UPLOAD_FEATURE = 'speaking'
/** 1 initial + 3 retries = 4 total attempts (AC13). */
export const SPEAKING_UPLOAD_MAX_ATTEMPTS = 4
const DEFAULT_BACKOFF_BASE_MS = 800
const UPLOAD_TIMEOUT_MS = 60_000

// Transient presign/confirm ApiError statuses that ride the retry ladder (R43): a
// network drop (`api-fetch` maps an offline/failed fetch to status 0 / `NETWORK`)
// and the gateway 5xx family. A permanent 4xx (413 over-cap, 400, 403) is never
// retried. The PUT leg is handled separately — any `TransferError` retries there,
// because re-presigning per attempt mints a fresh SEC-8 signature.
const RETRYABLE_API_STATUSES = new Set([0, 502, 503, 504])

interface PresignResult {
  url: string
  key: string
}

/** The retryable transfer-phase error (network / non-2xx PUT), distinct from ApiError. */
export class TransferError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TransferError'
  }
}

/** Thrown by the client 25 MB pre-check BEFORE any presign (AC16 layer 1). */
export class SpeakingUploadTooLargeError extends Error {
  constructor() {
    super('speaking recording exceeds the size limit')
    this.name = 'SpeakingUploadTooLargeError'
  }
}

/** Thrown when an in-flight upload is aborted (unmount / read-only flip). */
export class UploadAbortedError extends Error {
  constructor() {
    super('speaking upload aborted')
    this.name = 'UploadAbortedError'
  }
}

/** presign → PresignResult{url,key}. sizeBytes is enforced against the 25 MB cap server-side. */
export async function presignSpeakingUpload(
  params: { filename: string; contentType: CanonicalAudioMime; sizeBytes: number },
  signal?: AbortSignal,
): Promise<PresignResult> {
  return apiFetch<PresignResult>('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: params.filename,
      contentType: params.contentType,
      feature: SPEAKING_UPLOAD_FEATURE,
      sizeBytes: params.sizeBytes,
    }),
    signal,
  })
}

/** Direct R2 PUT via XHR with a locked Content-Type, progress, abort, and TransferError. */
export function transferToStorage(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError())
      return
    }
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    signal?.addEventListener('abort', () => xhr.abort(), { once: true })
    xhr.upload.onprogress = (event) => {
      if (onProgress) onProgress(event.total > 0 ? event.loaded / event.total : 0)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new TransferError(`R2 PUT failed with status ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new TransferError('R2 PUT network error'))
    xhr.ontimeout = () => reject(new TransferError('R2 PUT timed out'))
    xhr.onabort = () => reject(new UploadAbortedError())
    xhr.send(blob)
  })
}

/** confirm → HeadObject verify (non-knowledge branch echoes metadata; no files row). */
export async function confirmSpeakingUpload(
  params: { key: string; sizeBytes: number },
  signal?: AbortSignal,
): Promise<void> {
  await apiFetch('/api/uploads/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      key: params.key,
      name: null,
      folderId: null,
      sizeBytes: params.sizeBytes,
    }),
    signal,
  })
}

export interface UploadSpeakingParams {
  blob: Blob
  contentType: CanonicalAudioMime
  ext: '.webm' | '.m4a'
  onProgress?: (fraction: number) => void
  /** Fired with the upcoming attempt number when a retry is scheduled (surface "retrying…"). */
  onRetry?: (nextAttempt: number) => void
  signal?: AbortSignal
  /** Backoff base in ms (exponential per attempt); injectable for tests. */
  backoffBaseMs?: number
}

export interface UploadSpeakingResult {
  key: string
}

function isRetryable(error: unknown): boolean {
  if (error instanceof TransferError) return true
  if (error instanceof ApiError) return RETRYABLE_API_STATUSES.has(error.status)
  return false
}

function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new UploadAbortedError())
      return
    }
    const id = setTimeout(resolve, ms)
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(id)
        reject(new UploadAbortedError())
      },
      { once: true },
    )
  })
}

/**
 * Run the full speaking upload chain with automatic retry.
 * @returns the confirmed R2 key.
 * @throws SpeakingUploadTooLargeError (pre-check), UploadAbortedError (aborted),
 *   or the last TransferError/ApiError after all attempts are exhausted.
 */
export async function uploadSpeakingAudio(
  params: UploadSpeakingParams,
): Promise<UploadSpeakingResult> {
  const { blob, contentType, ext, onProgress, onRetry, signal } = params
  const backoffBaseMs = params.backoffBaseMs ?? DEFAULT_BACKOFF_BASE_MS

  // AC16 layer 1 — client 25 MB pre-check BEFORE any network call.
  if (blob.size > SPEAKING_AUDIO_MAX_BYTES) {
    throw new SpeakingUploadTooLargeError()
  }

  const filename = `recording${ext}`
  let lastError: unknown

  for (let attempt = 1; attempt <= SPEAKING_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) throw new UploadAbortedError()
    try {
      const presigned = await presignSpeakingUpload(
        { filename, contentType, sizeBytes: blob.size },
        signal,
      )
      await transferToStorage(presigned.url, blob, contentType, onProgress, signal)
      await confirmSpeakingUpload({ key: presigned.key, sizeBytes: blob.size }, signal)
      return { key: presigned.key }
    } catch (error) {
      if (error instanceof UploadAbortedError) throw error
      lastError = error
      if (!isRetryable(error) || attempt === SPEAKING_UPLOAD_MAX_ATTEMPTS) {
        throw error
      }
      onRetry?.(attempt + 1)
      // Abortable backoff — an unmount here fires no further presign / R2 PUT.
      await abortableDelay(backoffBaseMs * 2 ** (attempt - 1), signal)
    }
  }
  throw lastError
}
