/**
 * uploadErrorCopy — the single source of truth mapping an upload failure to its
 * i18n copy (Story 4.4b, AC4). Both the CLIENT pre-check and the SERVER
 * rejection route through here so the two are INDISTINGUISHABLE (AC4b): a
 * client-caught over-cap file and a server-caught over-cap file show the exact
 * same `tooLarge` message with the same cap. Storage-full is flagged (not given
 * a key) because its copy is role-split — the dialog resolves it via
 * {@link storageFullCopyKey}.
 */
import { type ApiError } from '@/lib/api-fetch'
import { TransferError } from '../api/uploadKnowledgeFile'
import { capMegabytes, maxBytesForKnowledgeFile } from './knowledgeHubSchemas'

/** Which phase of the upload chain a failure occurred in. */
export type UploadStage = 'presign' | 'transfer' | 'finalize'

export interface UploadErrorCopy {
  /** i18n key for the human message; `null` when the failure is storage-full
   * (the caller supplies the role-split copy instead). */
  messageKey: string | null
  /** Interpolation params (e.g. the cap in MB). */
  params?: Record<string, unknown>
  /** True when a Retry (re-run from presign, same file) can recover it (AC4c). */
  retryable: boolean
  /** True for a 409 STORAGE_FULL — the caller renders role-split copy (AC7). */
  storageFull: boolean
}

/** capMbForFile is the per-extension cap in whole MB, or 0 for unknown types. */
function capMbForFile(file: File): number {
  const cap = maxBytesForKnowledgeFile(file.name)
  return cap === null ? 0 : capMegabytes(cap)
}

/** The shared "too large" copy — used by both the client pre-check and 413. */
export function tooLargeCopy(file: File): UploadErrorCopy {
  return {
    messageKey: 'knowledgeHub.upload.error.tooLarge',
    params: { capMb: capMbForFile(file) },
    retryable: false,
    storageFull: false,
  }
}

/** The shared "wrong type" copy — used by both the client pre-check and 422. */
export function wrongTypeCopy(): UploadErrorCopy {
  return { messageKey: 'knowledgeHub.upload.error.wrongType', retryable: false, storageFull: false }
}

/**
 * uploadErrorCopy classifies a thrown error from any stage. `TransferError`
 * (the raw PUT) and a 502 (HeadObject transport fail) are retryable; a 413/422
 * reuses the same client copy; a 409 flags storage-full for role-split copy.
 */
export function uploadErrorCopy(stage: UploadStage, err: unknown, file: File): UploadErrorCopy {
  if (err instanceof TransferError) {
    return { messageKey: 'knowledgeHub.upload.error.transfer', retryable: true, storageFull: false }
  }
  if (isApiError(err)) {
    if (err.status === 413) return tooLargeCopy(file)
    if (err.status === 409 || err.code === 'STORAGE_FULL') {
      return { messageKey: null, retryable: false, storageFull: true }
    }
    if (err.status === 422) return wrongTypeCopy()
    if (err.status === 502) {
      return { messageKey: 'knowledgeHub.upload.error.verify', retryable: true, storageFull: false }
    }
  }
  // Unknown / generic per-stage failure (never a raw HTTP code in the UI, AC4).
  const key =
    stage === 'presign'
      ? 'knowledgeHub.upload.error.presign'
      : stage === 'transfer'
        ? 'knowledgeHub.upload.error.transfer'
        : 'knowledgeHub.upload.error.finalize'
  return { messageKey: key, retryable: stage !== 'presign', storageFull: false }
}

/** Narrow an unknown throwable to ApiError by its structural shape. */
function isApiError(err: unknown): err is ApiError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'status' in err &&
    'code' in err &&
    typeof (err as { status: unknown }).status === 'number'
  )
}
