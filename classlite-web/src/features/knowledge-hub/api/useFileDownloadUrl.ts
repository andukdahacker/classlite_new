/**
 * useFileDownloadUrl — fetch a short-lived presigned GET URL for a file's stored
 * object (Story 4.4b, AC5 preview/download).
 *
 * Two disposition variants back two distinct affordances:
 *   - `'inline'` (default) → the URL serves the object inline, so it can back the
 *     preview `<img>`/`<audio>`/`<embed>`.
 *   - `'attachment'` → the signed URL carries `Content-Disposition: attachment`
 *     with the original filename, forcing a real download. This is required
 *     because R2 URLs are cross-origin, so the HTML `download` attribute is
 *     ignored — the server-signed disposition is the only way to force a
 *     download (and to stop a stored SVG/HTML opening inline as a document).
 *
 * The URL expires in 5 minutes server-side, so `staleTime` is kept below that
 * (4 min). `enabled` gates the fetch so a pane that won't use a URL never asks.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { knowledgeHubKeys } from './knowledgeHubKeys'

export type DownloadUrlWire = components['schemas']['DownloadUrl']

/** Which disposition the signed URL should carry. */
export type DownloadDisposition = 'inline' | 'attachment'

const DOWNLOAD_URL_STALE_MS = 4 * 60 * 1000 // < the 5-min server expiry

/** useFileDownloadUrl fetches a presigned GET URL for `slug`'s object. */
export function useFileDownloadUrl(
  slug: string | null,
  enabled: boolean,
  disposition: DownloadDisposition = 'inline',
) {
  return useQuery<DownloadUrlWire, ApiError>({
    queryKey: [...knowledgeHubKeys.fileDetail(slug ?? '__none__'), 'download', disposition],
    queryFn: () =>
      apiFetch<DownloadUrlWire>(
        `/api/knowledge-hub/files/${encodeURIComponent(slug ?? '')}/download${
          disposition === 'attachment' ? '?disposition=attachment' : ''
        }`,
      ),
    enabled: enabled && Boolean(slug),
    staleTime: DOWNLOAD_URL_STALE_MS,
  })
}
