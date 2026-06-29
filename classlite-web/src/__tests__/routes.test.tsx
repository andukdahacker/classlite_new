/**
 * routes.tsx — index-loader query-forward (Story 1-9c AC6 — Murat BLOCKER).
 *
 * Pins the contract that `/?invited=true` redirects to `/login?invited=true`
 * (preserving the query). Without this test, a future "let me clean up that
 * weird `+ url.search`" PR on the index loader silently kills the entire
 * OAuth-success → invited banner pipeline and zero CI tests fire. The test
 * belongs on the routes seam, not LoginPage — LoginPage only sees the
 * post-redirect URL.
 *
 * Imports `indexLoader` directly from `routes.tsx` so the test exercises the
 * production loader function. The route table is a minimal sibling-Route
 * harness (avoids booting AuthLayout / i18n / QueryClient / Sentry chunks)
 * — but the loader itself is the real, exported one. If a future PR edits
 * `indexLoader` in `routes.tsx`, these assertions go red.
 */
import { describe, expect, test } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import {
  createMemoryRouter,
  RouterProvider,
  useLocation,
  useSearchParams,
  type RouteObject,
} from 'react-router'
import { indexLoader } from '@/routes'

function UrlProbe() {
  const location = useLocation()
  const [params] = useSearchParams()
  return (
    <>
      <span data-testid="probe-pathname">{location.pathname}</span>
      <span data-testid="probe-invited">{params.get('invited') ?? ''}</span>
      <span data-testid="probe-error">{params.get('error') ?? ''}</span>
      <span data-testid="probe-hash">{location.hash}</span>
    </>
  )
}

const harnessRoutes: RouteObject[] = [
  { index: true, loader: indexLoader },
  { path: 'login', element: <UrlProbe /> },
]

describe('routes.tsx — index loader query-forward (Story 1-9c AC6, Murat BLOCKER)', () => {
  test('forwards ?invited=true from / to /login?invited=true', async () => {
    const router = createMemoryRouter(harnessRoutes, {
      initialEntries: ['/?invited=true'],
    })
    const { findByTestId } = render(<RouterProvider router={router} />)
    const pathname = await findByTestId('probe-pathname')
    const invited = await findByTestId('probe-invited')
    await waitFor(() => {
      expect(pathname.textContent).toBe('/login')
      expect(invited.textContent).toBe('true')
    })
  })

  test('preserves the empty query when ? is absent', async () => {
    const router = createMemoryRouter(harnessRoutes, {
      initialEntries: ['/'],
    })
    const { findByTestId } = render(<RouterProvider router={router} />)
    const pathname = await findByTestId('probe-pathname')
    const invited = await findByTestId('probe-invited')
    await waitFor(() => {
      expect(pathname.textContent).toBe('/login')
      expect(invited.textContent).toBe('')
    })
  })

  test('forwards multiple query params together (?invited=true&error=x)', async () => {
    const router = createMemoryRouter(harnessRoutes, {
      initialEntries: ['/?invited=true&error=invite_email_mismatch'],
    })
    const { findByTestId } = render(<RouterProvider router={router} />)
    await waitFor(async () => {
      expect((await findByTestId('probe-pathname')).textContent).toBe('/login')
      expect((await findByTestId('probe-invited')).textContent).toBe('true')
      expect((await findByTestId('probe-error')).textContent).toBe(
        'invite_email_mismatch',
      )
    })
  })

  // Hash-forwarding contract is verified by inspection — `indexLoader` reads
  // `new URL(request.url).hash` and appends it to the redirect target.
  // `createMemoryRouter` strips the fragment when parsing `initialEntries`
  // so it cannot simulate the production browser-router path; a unit test
  // here would assert against the memory router's parser, not the loader.
  // The hash-append guards against the same "silent flatten" defect class
  // as the query-string forward above (Blind Hunter P7).

})
