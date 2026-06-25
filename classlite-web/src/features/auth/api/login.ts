/**
 * useLogin — Story 1-8 AC5.
 *
 * Mutation hook for `POST /api/auth/login`. On success, populates the
 * `authKeys.session()` cache with the parsed `{ user, accessToken }` so
 * the dashboard's `useAuth()` flips to authenticated on the next render
 * tick, then navigates to `/dashboard` with `replace: true` (UX-DR15
 * mobile hygiene — the back button must NOT return to the login form).
 *
 * Error UX is OWNED BY THE PAGE — `useLogin` doesn't carry an `onError`
 * because the page-level component needs typed access to the `ApiError`
 * to differentiate 401 / 429 / 422 / generic + iterate `details` for
 * field-level error mapping. The mutation surface stays minimal.
 *
 * Mock seam: this hook is exercised through MSW per project-context
 * TEST-FE-1. No internal mocks; tests render with
 * `createTestQueryClient()` + override the MSW handler per case.
 */
import { useMutation } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { broadcastLoginSucceeded } from '@/lib/auth-refresh'
import type { components } from '@/lib/api/client'

type LoginRequest = components['schemas']['LoginRequest']
type LoginResult = components['schemas']['LoginResult']

export function useLogin() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation<LoginResult, Error, LoginRequest>({
    // Distinct from the cache key — see authKeys.ts JSDoc (P5
    // amendment 2026-06-25). The session-cache write below uses
    // `authKeys.session()`; the mutation lives under its own key.
    mutationKey: authKeys.loginMutation(),
    mutationFn: (req) =>
      // `surfaceAuthError: true` — a 401 from /api/auth/login means
      // "wrong credentials," not "session expired." This option
      // bypasses both the refresh coordinator AND the
      // AuthExpiredError translation so the page sees the original
      // `ApiError(401, 'INVALID_CREDENTIALS', ...)` and can render
      // the inline copy.
      apiFetch<LoginResult>('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(req),
        surfaceAuthError: true,
      }),
    onSuccess: (result) => {
      const session: Session = {
        user: result.user,
        accessToken: result.accessToken,
      }
      queryClient.setQueryData<Session>(authKeys.session(), session)
      // Story 1-9a Layer B — broadcast the login to sibling tabs so a
      // 3-tabs-polling-for-verification user doesn't sit on stale
      // login forms after they finish in one tab. The local cache
      // write above covers THIS tab; the broadcast hydrates siblings.
      broadcastLoginSucceeded({
        user: result.user,
        accessToken: result.accessToken,
      })
      // `replace: true` — submitting again via back+refresh would
      // double-trigger the lockout counter; replace pops the form off
      // the history stack entirely.
      navigate('/dashboard', { replace: true })
    },
    // NO onError — the page-level component handles error → setError /
    // Alert rendering so error UX is co-located with the form (TS-5 /
    // FW-2 — the optimistic-triple doesn't apply, no list to roll back).
  })
}
