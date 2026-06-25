/**
 * useVerifyEmail — Story 1-9a AC6.
 *
 * Mutation hook for `POST /api/auth/verify-email`. Click-through mode
 * fires this mutation exactly once on mount via the page-level effect
 * (`!verifyEmail.isIdle` guard — see VerifyEmailPage Dev Notes for the
 * StrictMode-defense rationale that replaced the original useRef latch).
 *
 * No `onSuccess` cache write — verify alone does NOT issue a session
 * (the response shape is `{ verified, email }` with no access token).
 * The user must log in afterward; the redirect target on success is
 * `/login?verified=1` per AC6.
 *
 * Mock seam: this hook is exercised through MSW per project-context
 * TEST-FE-1.
 */
import { useMutation } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type VerifyEmailRequest = components['schemas']['VerifyEmailRequest']
type VerifyEmailResult = components['schemas']['VerifyEmailResult']

export function useVerifyEmail() {
  return useMutation<VerifyEmailResult, Error, VerifyEmailRequest>({
    mutationKey: authKeys.verifyEmailMutation(),
    mutationFn: (req) =>
      apiFetch<VerifyEmailResult>('/api/auth/verify-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    // No onSuccess — page owns the redirect after the success aria-live
    // announcement holds for VERIFY_REDIRECT_DELAY_MS (scheduled inside
    // a useEffect keyed on result.verified === true so the cleanup owns
    // clearTimeout). See VerifyEmailPage.tsx for the wiring + the
    // pinned R-NEW=12 regression guards.
    // No onError — page renders inline alert / expired / invalid states.
  })
}
