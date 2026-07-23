/**
 * useLogout — tears the session down on BOTH the server and the client.
 *
 * `POST /api/auth/logout` revokes the refresh-token family server-side AND
 * emits the clearing `Set-Cookie` that discards the httpOnly `refresh_token`
 * cookie (see `auth_handler.go` Logout — the clearing cookie is written
 * BEFORE the service call, so the browser drops it even if the service errors).
 * We then clear the `authKeys.session()` cache so `useAuth()` flips to
 * unauthenticated.
 *
 * Prior to this hook, the onboarding "Sign out" affordance navigated to a bare
 * `/logout` URL — which is NOT a route (→ NotFound) and never called the API,
 * so the refresh cookie was never cleared (fixed 2026-07-23).
 *
 * **Navigation is the caller's concern** (mirrors `useLogin`). Callers
 * hard-redirect to `/login` so every scrap of in-memory React state is
 * dropped; on the reload the boot probe's refresh hits the now-cleared cookie,
 * 401s, and the user lands logged-out.
 *
 * Best-effort: the cache clear runs in `onSettled`, so even a network failure
 * on the POST still logs the user out client-side. `skipAuthRefresh` keeps a
 * (theoretical) 401 from kicking off the refresh coordinator — tearing the
 * session down must never try to silently re-establish it.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys } from '@/features/auth/api/authKeys'
import type { components } from '@/lib/api/client'

type LogoutResult = components['schemas']['LogoutResult']

export function useLogout() {
  const queryClient = useQueryClient()
  return useMutation<LogoutResult | undefined, Error, void>({
    mutationFn: () =>
      apiFetch<LogoutResult>('/api/auth/logout', {
        method: 'POST',
        skipAuthRefresh: true,
      }),
    onSettled: () => {
      // `null` (not `undefined`) is the "explicitly logged out" sentinel the
      // App.tsx boot probe checks for — it distinguishes a cleared session
      // from a never-hydrated one and avoids a doomed refresh on reload.
      queryClient.setQueryData(authKeys.session(), null)
    },
  })
}
