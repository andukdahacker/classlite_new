/**
 * useAcceptInvite — Story 1-9c AC4.
 *
 * Mutation hook for `POST /api/auth/accept-invite`. On 200 success, populates
 * `authKeys.session()` with `{ user, accessToken }` from the response so
 * `useAuth().isAuthenticated` flips true on the next render tick, broadcasts
 * the login to sibling tabs via `broadcastLoginSucceeded`, then navigates to
 * `/dashboard` with `replace: true`. Mirrors `useLogin` (api/login.ts) — the
 * accept-invite success path IS a login from the cache's perspective: the
 * backend has issued the refresh-token cookie + accessToken alongside the
 * membership row insert in a single transactional commit.
 *
 * Error UX is OWNED BY THE PAGE — `useAcceptInvite` carries no `onError`
 * because the page-level component needs typed access to `ApiError.code` /
 * `ApiError.details` / `ApiError.retryAfterSeconds` to branch into the
 * dedicated terminal regions (notFound / expired / alreadyAccepted /
 * emailMismatch / passwordNotAllowed / emailAlreadyRegistered / invalidToken)
 * vs the inline alert path (429 / 422 / 5xx).
 *
 * Mock seam: TEST-FE-1 — MSW intercepts at the HTTP boundary. No internal
 * mocks; tests render with `createTestQueryClient()` + override the MSW
 * handler per case.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { broadcastLoginSucceeded } from '@/lib/auth-refresh'
import type { components } from '@/lib/api/client'

type AcceptInviteRequest = components['schemas']['AcceptInviteRequest']
type AcceptInviteResult = components['schemas']['AcceptInviteResult']

/**
 * Optional stale-mutation guard. When the page's active invite token has
 * changed mid-flight (user edits the URL bar to `/invite/B` while the
 * `/invite/A` request is still pending), the page passes a getter so the
 * hook can compare the mutation's `vars.inviteToken` against the page's
 * current token at settle time and skip session cache write + navigate
 * for the now-stale result.
 */
type GetActiveToken = () => string | null | undefined

export function useAcceptInvite(getActiveToken?: GetActiveToken) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation<AcceptInviteResult, Error, AcceptInviteRequest>({
    mutationKey: authKeys.acceptInviteMutation(),
    mutationFn: (req) =>
      // `surfaceAuthError: true` — a 401 (if it ever surfaces from this
      // endpoint, e.g. backend race during cookie issue) means
      // "credentials invalid for this request," not "session expired."
      // Bypassing the refresh coordinator keeps the page seeing the
      // original ApiError so it can render the relevant inline copy.
      apiFetch<AcceptInviteResult>('/api/auth/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        surfaceAuthError: true,
      }),
    onSuccess: (result, vars) => {
      // Stale-mutation guard — if the page's active token has changed
      // since this mutation fired, the result is for a different invite
      // and must NOT populate the session cache or navigate (we'd land
      // an authenticated session for the WRONG center).
      if (
        getActiveToken !== undefined &&
        getActiveToken() !== vars.inviteToken
      ) {
        return
      }
      const session: Session = {
        user: result.user,
        accessToken: result.accessToken,
        // Story 2-3a AC9 — invited teachers land on a center owned by
        // someone else; `Session.center` remains null in the invitee's
        // client cache. Populating this field with the invite's target
        // center would mislead `useCurrentCenter` selectors.
        center: null,
        // Story 2.6 (AC2). Accept-invite always returns the newly-minted
        // membership role in the response body (api.yaml
        // AcceptInviteResult.role), so this is never null on the happy
        // path. `useRole()` immediately reflects the invited role.
        role: result.role,
      }
      queryClient.setQueryData<Session>(authKeys.session(), session)
      broadcastLoginSucceeded({
        user: result.user,
        accessToken: result.accessToken,
        role: result.role,
        // Invited teachers don't own the target center — keep `Session.center`
        // null in the invitee's cache (see the session write above).
        center: null,
      })
      navigate('/dashboard', { replace: true })
    },
    // No onError — page owns terminal-state vs inline-alert branching.
  })
}
