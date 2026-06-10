/**
 * Global TanStack Query client + 401 silent-refresh wiring.
 *
 * v5 idiom — the global error pipeline now lives on
 * `QueryCache.onError` / `MutationCache.onError`. Agents trained on v4's
 * `defaultOptions.queries.onError` will write the wrong shape and silently
 * skip the refresh path; the AC3 query-client-refresh test contract guards
 * against that regression.
 *
 * The 401 contract:
 *
 *   1. Any query/mutation that throws an `ApiError(401)` is routed through
 *      the global cache `onError` and handed to the auth-refresh
 *      coordinator. Components never see the 401 — by the time the
 *      promise chain unwinds, either the request has succeeded on retry
 *      or the tab is redirecting to `/login`.
 *
 *   2. `retry` is `false` for auth errors so TanStack Query's own retry
 *      machinery doesn't race the refresh coordinator. Other errors get
 *      a single retry (`failureCount < 1`).
 *
 *   3. Mutations never auto-retry (project-context FW-2 — manual
 *      optimistic-update triple is the canonical path).
 *
 *   4. `staleTime: 30_000` is the project default, established by the
 *      1-7a review pass. Deviations require an inline justification per
 *      project-context FW-3.
 */
import {
  MutationCache,
  QueryCache,
  QueryClient,
} from '@tanstack/react-query'
import { ApiError, AuthExpiredError } from './api-fetch'
import { onAuthFailure } from './auth-refresh'

const DEFAULT_STALE_TIME_MS = 30_000
const MAX_QUERY_RETRIES = 1
const UNAUTHORIZED_STATUS = 401

export function isAuthError(error: unknown): boolean {
  if (error instanceof AuthExpiredError) return true
  if (error instanceof ApiError && error.status === UNAUTHORIZED_STATUS) {
    return true
  }
  return false
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: DEFAULT_STALE_TIME_MS,
      retry: (failureCount, error) => {
        if (isAuthError(error)) return false
        return failureCount < MAX_QUERY_RETRIES
      },
    },
    mutations: {
      retry: false,
    },
  },
  queryCache: new QueryCache({
    onError: (error) => {
      // Use `isAuthError` (covers both AuthExpiredError AND a raw
      // ApiError(401)) so a stray 401 from a caller that bypassed the
      // apiFetch refresh path still triggers the redirect. The latch
      // inside `onAuthFailure` collapses double-fires from apiFetch's
      // direct call so we never get two redirects per 401.
      if (isAuthError(error)) onAuthFailure(error as Error)
    },
  }),
  mutationCache: new MutationCache({
    onError: (error) => {
      if (isAuthError(error)) onAuthFailure(error as Error)
    },
  }),
})
