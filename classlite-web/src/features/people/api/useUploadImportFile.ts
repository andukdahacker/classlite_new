/**
 * useUploadImportFile — presign → direct browser PUT → return the object key
 * (Story 2.7). There is no FE presign precedent, so this is built fresh:
 *
 *   1. POST /api/uploads/presign { filename, contentType, feature: 'imports' }
 *      → { url, key }  (apiFetch unwraps the {data} envelope)
 *   2. PUT the raw file bytes to `url` via XMLHttpRequest — XHR (not fetch) so we
 *      get upload-progress events AND stay clear of the `no-restricted-globals`
 *      fetch ban. The Content-Type is locked to the presigned value (SEC-8).
 *   3. Resolve with `{ key }` for the preview/confirm calls.
 *
 * Progress is surfaced via the `onProgress` callback (0..1) so the page can drive
 * the upload phase of its 3-phase indicator (upload / parsing / done).
 */
import { apiFetch } from '@/lib/api-fetch'
import { IMPORT_CONTENT_TYPE_BY_EXT, extensionOf } from '../lib/schemas'

interface PresignResponse {
  url: string
  key: string
}

const PRESIGN_FEATURE = 'imports'

/** Abort a stalled presigned PUT so the uploading phase can't hang forever. */
const UPLOAD_TIMEOUT_MS = 60_000

function contentTypeForFile(filename: string): string {
  return IMPORT_CONTENT_TYPE_BY_EXT[extensionOf(filename)] ?? ''
}

/** putToStorage streams the file to the presigned URL, reporting 0..1 progress. */
function putToStorage(
  url: string,
  file: File,
  contentType: string,
  onProgress?: (fraction: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.setRequestHeader('Content-Type', contentType)
    xhr.timeout = UPLOAD_TIMEOUT_MS
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && onProgress) {
        onProgress(event.loaded / event.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`upload failed with status ${xhr.status}`))
      }
    }
    xhr.onerror = () => reject(new Error('upload network error'))
    xhr.ontimeout = () => reject(new Error('upload timed out'))
    xhr.send(file)
  })
}

/**
 * uploadImportFile runs the full presign → PUT flow and returns the object key.
 * A plain async function (not a hook) so the page can await it inline and own the
 * phase state machine.
 */
export async function uploadImportFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<{ key: string }> {
  const contentType = contentTypeForFile(file.name)
  const presigned = await apiFetch<PresignResponse>('/api/uploads/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filename: file.name,
      contentType,
      feature: PRESIGN_FEATURE,
    }),
  })
  await putToStorage(presigned.url, file, contentType, onProgress)
  return { key: presigned.key }
}
