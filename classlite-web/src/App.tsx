/**
 * App — top-level mount point.
 *
 * Three load-bearing pieces composed here:
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
 */
import { RouterProvider } from 'react-router'
import { ErrorBoundary } from '@/components/shared/ErrorBoundary'
import { useLanguageInit } from '@/hooks/useLanguageInit'
import { router } from '@/routes'
import { Toaster } from '@/components/ui/sonner'
import { TooltipProvider } from '@/components/ui/tooltip'

export default function App() {
  useLanguageInit()
  return (
    <ErrorBoundary>
      <TooltipProvider>
        <Toaster richColors closeButton />
        <RouterProvider router={router} />
      </TooltipProvider>
    </ErrorBoundary>
  )
}
