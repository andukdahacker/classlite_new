/**
 * MSW default handlers — the canonical happy-path stubs for the 6 auth
 * endpoints Story 1-8 consumes.
 *
 * Per project-context TEST-FE-1 (single mock seam at the HTTP boundary)
 * the contract here is "tests get the success path by default; override
 * via `server.use(...)` for error / loading variants per test." This
 * matches the catalog at `_bmad-output/test-artifacts/msw-handler-catalog-auth.md`.
 *
 * Why the bare `/api/auth/...` paths (no host prefix) — `apiFetch` issues
 * relative-URL fetches and MSW intercepts on URL pathname; jsdom's base
 * is `http://localhost:5173/` per `vitest.config.ts` so MSW resolves the
 * relative path under that origin.
 *
 * Per-test variants register via `server.use(...)` and the
 * `afterEach(server.resetHandlers())` in `vitest-setup.ts` wipes them.
 * NEVER mutate this default array from inside a test — the override
 * mechanism is the only sanctioned escape hatch.
 */
import { http, HttpResponse } from 'msw'
import type { components } from '@/lib/api/client'

type Envelope<T> = { data: T }
type UserSummary = components['schemas']['UserSummary']
type LoginResult = components['schemas']['LoginResult']
type RegisterResult = components['schemas']['RegisterResult']
type LogoutResult = components['schemas']['LogoutResult']
type ForgotPasswordResult = components['schemas']['ForgotPasswordResult']
type ResetPasswordResult = components['schemas']['ResetPasswordResult']

const MSW_USER: UserSummary = {
  id: '00000000-0000-0000-0000-00000000msw1',
  email: 'msw@example.com',
  fullName: 'MSW Test User',
  emailVerified: true,
}

export const handlers = [
  http.post('/api/auth/register', async ({ request }) => {
    const body = (await request.json()) as { email: string }
    const user: UserSummary = {
      ...MSW_USER,
      id: '00000000-0000-0000-0000-000000msw01',
      email: body.email,
      // Registration leaves the user unverified — 1.9a polls + verifies.
      emailVerified: false,
    }
    const result: RegisterResult = {
      user,
      verifyPollId: '00000000-0000-0000-0000-poll00000001',
      emailDelivery: 'sent',
    }
    return HttpResponse.json<Envelope<RegisterResult>>(
      { data: result },
      { status: 201 },
    )
  }),

  http.post('/api/auth/login', async ({ request }) => {
    const body = (await request.json()) as { email: string }
    const result: LoginResult = {
      accessToken: 'msw.jwt.signature',
      user: { ...MSW_USER, email: body.email },
    }
    return HttpResponse.json<Envelope<LoginResult>>(
      { data: result },
      {
        status: 200,
        headers: {
          'Set-Cookie':
            'refresh_token=msw-refresh-token; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
        },
      },
    )
  }),

  http.post('/api/auth/refresh', () => {
    const result: LoginResult = {
      accessToken: 'msw.refreshed.jwt',
      user: MSW_USER,
    }
    return HttpResponse.json<Envelope<LoginResult>>(
      { data: result },
      {
        status: 200,
        headers: {
          'Set-Cookie':
            'refresh_token=msw-rotated-token; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
        },
      },
    )
  }),

  http.post('/api/auth/logout', () => {
    return HttpResponse.json<Envelope<LogoutResult>>(
      { data: { loggedOut: true } },
      {
        status: 200,
        headers: {
          'Set-Cookie':
            'refresh_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
        },
      },
    )
  }),

  http.post('/api/auth/forgot-password', () => {
    // Anti-enumeration — same body shape regardless of email status.
    return HttpResponse.json<Envelope<ForgotPasswordResult>>(
      { data: { sent: true } },
      { status: 200 },
    )
  }),

  http.post('/api/auth/reset-password', () => {
    return HttpResponse.json<Envelope<ResetPasswordResult>>(
      { data: { reset: true } },
      { status: 200 },
    )
  }),
]
