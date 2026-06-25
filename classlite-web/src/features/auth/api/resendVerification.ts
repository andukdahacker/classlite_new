/**
 * useResendVerification — Story 1-9a AC4.
 *
 * Mutation hook for `POST /api/auth/resend-verification`. The page
 * (VerifyEmailPage) owns the entire response UX surface:
 *   - 200 happy path → toast + 60s countdown + URL pollId update if
 *     `verifyPollId` is non-null (anti-enumeration null branch keeps the
 *     same UX, no URL change).
 *   - 429 RATE_LIMIT_EXCEEDED → form-level inline alert with the
 *     `retryAfterSeconds` count (driven by `ApiError.retryAfterSeconds`
 *     from 1-8's apiFetch).
 *   - 422 / 5xx / network → generic alert.
 *
 * No `onSuccess` cache write — the response carries a `verifyPollId`
 * (or null) but not a session. The page reads the returned value via
 * the mutation's `data`.
 *
 * Mock seam: this hook is exercised through MSW per project-context
 * TEST-FE-1 (single mock seam at the HTTP boundary).
 */
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type ResendVerificationRequest =
  components['schemas']['ResendVerificationRequest']
type ResendResult = components['schemas']['ResendResult']

export function useResendVerification() {
  return useMutation<ResendResult, Error, ResendVerificationRequest>({
    mutationKey: authKeys.resendMutation(),
    mutationFn: (req) =>
      apiFetch<ResendResult>('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    // No onSuccess — page owns URL update + toast.
    // No onError — page owns inline alert rendering.
  })
}
