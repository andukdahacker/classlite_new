/**
 * useForgotPassword — Story 1-9b AC3 / AC4.
 *
 * Mutation hook for `POST /api/auth/forgot-password`. The page
 * (ForgotPasswordPage) owns the entire response UX surface:
 *   - 200 happy path → swap to anti-enum confirmation region + 60s
 *     resend countdown. The response body shape `{ sent: true }` is
 *     identical regardless of whether the email is on file (backend
 *     anti-enumeration discipline, Story 1-5).
 *   - 429 RATE_LIMIT_EXCEEDED → form-level inline alert using
 *     `ApiError.retryAfterSeconds` from 1-8's apiFetch + countdown
 *     gating the submit button.
 *   - 422 / 5xx / network → generic alert + form stays in input mode.
 *
 * No `onSuccess` cache write — forgot-password does NOT issue a session;
 * the response carries `{ sent }` which the page reads via `data.sent`
 * if it ever needs to (today it only reacts on success vs error).
 *
 * Mock seam: this hook is exercised through MSW per project-context
 * TEST-FE-1 (single mock seam at the HTTP boundary).
 */
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type ForgotPasswordRequest = components['schemas']['ForgotPasswordRequest']
type ForgotPasswordResult = components['schemas']['ForgotPasswordResult']

export function useForgotPassword() {
  return useMutation<ForgotPasswordResult, Error, ForgotPasswordRequest>({
    mutationKey: authKeys.forgotPasswordMutation(),
    mutationFn: (req) =>
      apiFetch<ForgotPasswordResult>('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    // No onSuccess — page owns the form/confirmation swap + countdown start.
    // No onError — page owns inline alert rendering + 429 retryAfter handling.
  })
}
