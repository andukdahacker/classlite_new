/**
 * App — top-level mount point.
 *
 * Four load-bearing pieces composed here:
 *
 *   - `<ErrorBoundary>` (Story 1-7c) wraps the router so any render-time
 *     error in a lazy chunk surfaces a localized fallback with a Sentry
 *     event ID + retry CTA instead of unmounting to a blank page. The
 *     1-7b minimal `RootErrorBoundary` is retired.
 *   - `<RouterProvider router={router} />` (Story 1-7b) owns navigation
 *     via React Router v7 library mode; the dev-only routes (theme +
 *     multi-tab bait) live behind `import.meta.env.DEV` in `routes.tsx`.
 *   - `useLanguageInit()` (Story 1-7c) seeds the language store from
 *     the `lang` cookie on first render and subscribes to subsequent
 *     `setLanguage` mutations to keep the cookie + react-i18next active
 *     language in sync (UX-DR17 cross-subdomain handoff — landing site
 *     half lands with Story 1.10).
 *   - **Boot-time refresh probe (Story 1-8 Task 15).** On first mount,
 *     if `queryClient.getQueryData(['auth', 'session']) === undefined`
 *     (cache never written — distinct from `null` which a future logout
 *     flow would seed and which would otherwise spam doomed refresh
 *     calls on every post-logout reload, P11 amendment 2026-06-25),
 *     fire `runBootProbe()`. The success branch in `auth-refresh.ts`
 *     hydrates `useAuth()` via `setQueryData` BEFORE the first route
 *     paint — fixes the "user reloads `/dashboard` with valid refresh
 *     cookie, gets bounced to `/login`" regression Winston #4 surfaced
 *     on the 1-8 party-mode review pass.
 *
 *     `runBootProbe()` (NOT `refreshAccessToken()`) so `useAuth().isLoading`
 *     observes the in-flight state (D2 amendment 2026-06-25 — future
 *     route guards in Story 2.6 will wait for this signal before
 *     deciding the user is logged out).
 *
 *     Failure is silent (no toast, no redirect). The user simply sees
 *     `/login` — which is the correct end state for an unauthenticated
 *     session.
 *
 *     React 19 StrictMode double-mounts the effect; a `useRef(false)`
 *     latch keeps the probe to a single fire. (The `refreshPromise`
 *     coalescer in `auth-refresh.ts` would dedupe anyway, but the ref
 *     keeps the App.tsx surface clean.)
 */
import { useEffect, useRef } from 'react'
import { RouterProvider } from 'react-router'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { useLanguageInit } from '@/hooks/useLanguageInit'
import { router } from '@/routes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'
import { queryClient } from '@/lib/query-client'
import { runBootProbe } from '@/lib/auth-refresh'

export default function App() {
  useLanguageInit()
  const bootRefreshFired = useRef(false)

  useEffect(() => {
    if (bootRefreshFired.current) return
    bootRefreshFired.current = true
    const session = queryClient.getQueryData(['auth', 'session'])
    // Tighten guard — only probe when the cache has NEVER been written.
    // `null` is the sentinel a future logout flow seeds; without this
    // distinction, every post-logout reload fires a doomed refresh.
    if (session === undefined) {
      void runBootProbe()
    }
  }, [])

  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Toaster richColors closeButton />
        <RouterProvider router={router} />
      </TooltipProvider>
    </ErrorBoundary>
  )
}
