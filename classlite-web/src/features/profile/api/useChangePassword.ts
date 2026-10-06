/**
 * useChangePassword — Story 9.4 POST /api/users/me/change-password (AC4).
 *
 * No cache writes: the backend deliberately leaves OTHER sessions intact (AC4),
 * so there is nothing to invalidate. A 403 INVALID_CURRENT_PASSWORD (403 not 401
 * so it never trips the TS-5 silent-refresh path) / 409 PASSWORD_NOT_SET surfaces
 * as an ApiError the form maps inline (AC7). Success is a 204 (apiFetch returns
 * void).
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'

export type ChangePasswordRequest =
  components['schemas']['ChangePasswordRequest']

export function useChangePassword() {
  return useMutation<void, Error, ChangePasswordRequest>({
    mutationFn: (input) =>
      apiFetch<void>('/api/users/me/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
  })
}
