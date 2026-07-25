/**
 * useImportPreview — POST /api/students/import/preview (Story 2.7). Advisory
 * server-side parse + classify of the uploaded object `key`. Mutation (not a
 * query): it is triggered explicitly after the upload completes and has no
 * cacheable GET surface.
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { peopleKeys } from './peopleKeys'

export type ImportPreview = components['schemas']['ImportPreview']
export type ImportPreviewRow = components['schemas']['ImportPreviewRow']

export function useImportPreview() {
  return useMutation<ImportPreview, Error, { key: string }>({
    mutationKey: peopleKeys.importPreviewMutation(),
    mutationFn: ({ key }) =>
      apiFetch<ImportPreview>('/api/students/import/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      }),
  })
}
