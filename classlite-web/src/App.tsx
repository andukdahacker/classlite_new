/**
 * App — top-level mount point.
 *
 * The bespoke `usePathname()` + `useSyncExternalStore` switch from Story
 * 1-7a is retired; React Router v7's `createBrowserRouter` +
 * `RouterProvider` (defined in `routes.tsx`) owns navigation now. The
 * `/__theme-resolution` dev route migrated to a lazy router child without
 * URL or DOM change so the existing 1-7a Playwright theme/typography
 * specs continue to pass.
 *
 * `RootErrorBoundary` wraps the router so render-time errors in any
 * lazy chunk surface a localized fallback (with the error reported to
 * Sentry) instead of unmounting to a blank page.
 */
import { RouterProvider } from 'react-router'
import { RootErrorBoundary } from '@/components/shared/RootErrorBoundary'
import { router } from '@/routes'

export default function App() {
  return (
    <RootErrorBoundary>
      <RouterProvider router={router} />
    </RootErrorBoundary>
  )
}
