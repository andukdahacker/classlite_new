/**
 * OnboardingLayout — Story 2-3a AC8 + Task 1.
 *
 * Four route-guard branches must fire in a specific order — critically, the
 * "not authenticated → /login" branch MUST gate on the COMPOUND condition
 * `!isLoading && !isAuthenticated` (Winston-W2 party-mode fold). If it fires
 * on `!isAuthenticated` alone, the story ships the exact Story 1-8 boot-probe
 * race regression: user with valid refresh cookie gets bounced to /login
 * before the probe hydrates.
 *
 * RED phase: `@/features/onboarding/OnboardingLayout` doesn't exist yet.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClientProvider, QueryClient } from '@tanstack/react-query'
import { MemoryRouter, Routes, Route } from 'react-router'
import { I18nextProvider } from 'react-i18next'
import { HttpResponse, http } from 'msw'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import OnboardingLayout from '@/features/onboarding/OnboardingLayout'
import { onboardingHandlers } from '@/features/onboarding/api/__tests__/handlers'

function renderLayout(
  client: QueryClient,
  initialPath = '/welcome',
): { client: QueryClient } {
  const shell = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[initialPath]}>
          <Routes>
            <Route element={<OnboardingLayout />}>
              <Route path="/welcome" element={<p>welcome content</p>} />
              <Route
                path="/setup/center"
                element={<p>setup content</p>}
              />
            </Route>
            <Route path="/login" element={<p>login reached</p>} />
            <Route
              path="/verify-email"
              element={<p>verify-email reached</p>}
            />
            <Route path="/dashboard" element={<p>dashboard reached</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  render(shell)
  return { client }
}

const authenticatedVerified: Session = {
  user: {
    id: 'user-1',
    email: 'trang@example.com',
    fullName: 'Trang',
    emailVerified: true,
  } as unknown as Session['user'],
  accessToken: 'a.b.c',
  center: null,
}

beforeEach(() => {
  server.use(...onboardingHandlers)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('OnboardingLayout — AC8 route guard branches', () => {
  test('branch (a) isLoading → renders skeleton, does NOT navigate', async () => {
    const client = createTestQueryClient()
    // Do NOT seed session cache — useAuth().isLoading resolves TRUE until
    // boot probe completes. In test env, mimic by leaving cache as undefined
    // AND seeding the boot-probe in-flight flag if applicable.
    // Contract: layout renders a skeleton element with data-testid=skeleton-onboarding.
    renderLayout(client)

    // Skeleton is visible OR content NOT visible AND login NOT reached.
    expect(screen.queryByText('login reached')).not.toBeInTheDocument()
    expect(screen.queryByText('welcome content')).not.toBeInTheDocument()
  })

  test('branch (b) !isLoading && !isAuthenticated → navigate /login?next=', async () => {
    const client = createTestQueryClient()
    // Seed session cache with a null session state (probe resolved, no user).
    client.setQueryData(authKeys.session(), null)
    renderLayout(client)

    await waitFor(() =>
      expect(screen.getByText('login reached')).toBeInTheDocument(),
    )
  })

  test('branch (c) authenticated but emailVerified === false → navigate /verify-email', async () => {
    const client = createTestQueryClient()
    client.setQueryData<Session>(authKeys.session(), {
      ...authenticatedVerified,
      user: { ...authenticatedVerified.user, emailVerified: false },
    })
    renderLayout(client)

    await waitFor(() =>
      expect(screen.getByText('verify-email reached')).toBeInTheDocument(),
    )
  })

  test('branch (d) authenticated + verified + session.center != null → navigate /dashboard', async () => {
    const client = createTestQueryClient()
    client.setQueryData<Session>(authKeys.session(), {
      ...authenticatedVerified,
      center: {
        id: 'c1',
        name: 'Existing',
        shortCode: 'existing',
        // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
        brandColor: '#1e3a8a',
        logoUrl: null,
        timezone: 'Asia/Ho_Chi_Minh',
      },
    })
    renderLayout(client)

    await waitFor(() =>
      expect(screen.getByText('dashboard reached')).toBeInTheDocument(),
    )
  })

  test('happy path: authenticated + verified + no center → renders child route content', async () => {
    const client = createTestQueryClient()
    client.setQueryData<Session>(authKeys.session(), authenticatedVerified)
    renderLayout(client)

    await waitFor(() =>
      expect(screen.getByText('welcome content')).toBeInTheDocument(),
    )
  })

  test('Winston-W2: boot-probe race — session === undefined does NOT bounce to /login within one tick', async () => {
    // The classic bug: guard fires on `!isAuthenticated` (undefined) BEFORE
    // the probe hydrates. Contract: compound `!isLoading && !isAuthenticated`
    // means undefined session while probe in-flight stays on layout.
    const client = createTestQueryClient()
    // No setQueryData at all → cache slot is undefined.
    server.use(
      http.get('/api/onboarding/progress', () =>
        HttpResponse.json({
          data: {
            persona: null,
            currentStep: 'persona',
            payload: null,
            updatedAt: null,
          },
          meta: { serverTime: '2026-07-08T14:23:45.123Z' },
        }),
      ),
    )
    renderLayout(client)

    // Assert we did NOT immediately land on /login (would indicate the
    // un-gated `!isAuthenticated` bug pattern).
    expect(screen.queryByText('login reached')).not.toBeInTheDocument()
  })

  test('R1-P30: post-hydration — seeding session AFTER first tick fires the correct decision (verified + no center → welcome content renders)', async () => {
    const client = createTestQueryClient()
    // Start empty (matches Winston-W2 race — no cache slot yet).
    renderLayout(client)
    expect(screen.queryByText('login reached')).not.toBeInTheDocument()
    expect(screen.queryByText('welcome content')).not.toBeInTheDocument()

    // Simulate the boot probe resolving: cache now populated with an
    // authenticated verified user, no center.
    client.setQueryData(authKeys.session(), authenticatedVerified)

    // Contract: within a re-render, the layout renders the welcome content
    // (branch (d) does not trip — no center yet).
    await waitFor(() =>
      expect(screen.getByText('welcome content')).toBeInTheDocument(),
    )
    expect(screen.queryByText('login reached')).not.toBeInTheDocument()
    expect(screen.queryByText('dashboard reached')).not.toBeInTheDocument()
  })
})
