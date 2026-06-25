/**
 * useRegister — Story 1-8 AC5.
 *
 * Mutation hook for `POST /api/auth/register`. On success, populates the
 * `authKeys.session()` cache with `{user, accessToken: null}` (the
 * server has not issued an access token yet — verification gate sits
 * between registration and login per `api.yaml` story 1.4 contract),
 * then navigates to `/verify-email?pollId=...` (Story 1.9a owns the
 * destination; until 1.9a ships, the catch-all NotFound renders).
 *
 * `useAuth().isAuthenticated` returns FALSE for the registered-but-not-
 * verified user because the gate is `user.emailVerified`, not the
 * presence of `accessToken` — see authKeys.ts Session JSDoc.
 *
 * Email-delivery soft-failure side-effect: if the response's
 * `emailDelivery === 'failed'` (the verification email could not be
 * enqueued), the page-level component fires a non-blocking warning
 * toast. The mutation surface only writes the cache + navigates; toast
 * UX is co-located with the form.
 */
import { useMutation } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type RegisterRequest = components['schemas']['RegisterRequest']
type RegisterResult = components['schemas']['RegisterResult']

export function useRegister() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation<RegisterResult, Error, RegisterRequest>({
    // Distinct from useLogin's mutationKey + the cache key — see
    // authKeys.ts JSDoc (P5 amendment 2026-06-25).
    mutationKey: authKeys.registerMutation(),
    mutationFn: (req) =>
      apiFetch<RegisterResult>('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
      }),
    onSuccess: (result) => {
      const session: Session = {
        user: result.user,
        // Server has not issued an access token — the verification gate
        // sits between this success path and authenticated requests.
        // `useAuth().isAuthenticated` stays FALSE because
        // `user.emailVerified === false`.
        accessToken: null,
      }
      queryClient.setQueryData<Session>(authKeys.session(), session)
      // (P1 amendment 2026-06-25) encodeURIComponent — verifyPollId is
      // a server-controlled string today (UUID) but the URL is a public
      // surface and a future schema change to base64 / opaque token
      // would silently break the next route's param parsing without
      // the encoder. `replace: true` matches useLogin so the back
      // button can't return the user to the register form (re-submit
      // would 409 against their own just-created account).
      navigate(
        `/verify-email?pollId=${encodeURIComponent(result.verifyPollId)}`,
        { replace: true },
      )
    },
  })
}
