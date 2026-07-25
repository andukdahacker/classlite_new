/**
 * useConfirmImport — POST /api/students/import (Story 2.7). Authoritative commit:
 * the server re-parses + re-classifies and persists the valid rows in one tenant
 * transaction, returning a per-row outcome + counts (partial success possible).
 *
 * `importId` is a client-generated correlation UUID (audit + logs only — there is
 * no imports dedup table). The submit-lock in the page is the concurrency guard;
 * the server's uq_enrollments_active + ON CONFLICT keeps the DB correct anyway.
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { peopleKeys } from './peopleKeys'

export type ImportResult = components['schemas']['ImportResult']
export type ImportResultRow = components['schemas']['ImportResultRow']

export function useConfirmImport() {
  return useMutation<ImportResult, Error, { key: string; importId: string }>({
    mutationKey: peopleKeys.importConfirmMutation(),
    mutationFn: ({ key, importId }) =>
      apiFetch<ImportResult>('/api/students/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, importId }),
      }),
  })
}
