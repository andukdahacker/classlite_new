/**
 * useLogin — Story 1-8 AC5 (Story 1-9d AC4 amendment: dropped internal
 * navigate; LoginPage owns the destination via `mutate(..., { onSuccess })`).
 *
 * Mutation hook for `POST /api/auth/login`. On success, populates the
 * `authKeys.session()` cache with the parsed `{ user, accessToken }` so
 * the dashboard's `useAuth()` flips to authenticated on the next render
 * tick, then broadcasts to sibling tabs. **Navigation is the caller's
 * concern** — the hook stays destination-agnostic so any consumer
 * (LoginPage, future RegisterPage post-success auto-login, an admin
 * re-auth modal) can pass its own `onSuccess` that calls `navigate(...)`
 * with a context-appropriate URL.
 *
 * The Story 1-9d AC4 `?next=` whitelist consumer lives on LoginPage
 * (`sanitizeNextParam(searchParams.get('next'))`); moving the navigate
 * here would force every other caller to inherit the same URL semantics.
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
import { apiFetch } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { broadcastLoginSucceeded } from '@/lib/auth-refresh'
import type { components } from '@/lib/api/client'

type LoginRequest = components['schemas']['LoginRequest']
type LoginResult = components['schemas']['LoginResult']

export function useLogin() {
  const queryClient = useQueryClient()
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
      // Navigation is the caller's concern (Story 1-9d AC4 amendment).
      // LoginPage runs `navigate(sanitizeNextParam(searchParams.get('next')))`
      // via its own `mutate(values, { onSuccess })` after this hook's
      // onSuccess fires.
    },
    // NO onError — the page-level component handles error → setError /
    // Alert rendering so error UX is co-located with the form (TS-5 /
    // FW-2 — the optimistic-triple doesn't apply, no list to roll back).
  })
}
