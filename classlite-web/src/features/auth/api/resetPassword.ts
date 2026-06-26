/**
 * useResetPassword — Story 1-9b AC5 / AC6.
 *
 * Mutation hook for `POST /api/auth/reset-password`. The page
 * (ResetPasswordPage) owns the entire response UX surface:
 *   - 200 happy path → immediate `navigate('/login?reset=1', { replace })`.
 *     Backend invalidates ALL refresh tokens for the user on success — the
 *     login banner copy at `auth.login.banner.reset` explicitly tells the
 *     user other devices have been signed out.
 *   - 410 RESET_TOKEN_EXPIRED → swap to expired state (UX-DR16 three-part).
 *   - 409 RESET_TOKEN_CONSUMED → swap to consumed state.
 *   - 404 RESET_TOKEN_INVALID → swap to invalid state.
 *   - 422 / 5xx / network → form-level generic alert; form stays in input mode.
 *
 * No `onSuccess` cache write — reset alone does NOT issue a session; the
 * response shape is `{ reset: true }` with no access token. The user must
 * log in afterward via the success banner on `/login?reset=1`.
 *
 * Mock seam: this hook is exercised through MSW per project-context
 * TEST-FE-1 (single mock seam at the HTTP boundary).
 */
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type ResetPasswordRequest = components['schemas']['ResetPasswordRequest']
type ResetPasswordResult = components['schemas']['ResetPasswordResult']

export function useResetPassword() {
  return useMutation<ResetPasswordResult, Error, ResetPasswordRequest>({
    mutationKey: authKeys.resetPasswordMutation(),
    mutationFn: (req) =>
      apiFetch<ResetPasswordResult>('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    // No onSuccess — page owns navigate('/login?reset=1') after success.
    // No onError — page owns the four error-state swaps + generic alert.
  })
}
