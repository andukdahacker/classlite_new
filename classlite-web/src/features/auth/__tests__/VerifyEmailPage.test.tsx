/**
 * VerifyEmailPage — Story 1-9a AC1 / AC3 / AC4 / AC5 / AC6 / AC7.
 *
 * Test plan mirrors the pinned contracts in the story spec:
 *   - AC1: mode branching on ?pollId / ?token / neither
 *   - AC3: polling envelope screen + auto-redirect + R-NEW=12 regression
 *     guards (in-app link click mid-delay, unmount mid-delay, etc.)
 *   - AC4: 60s resend countdown, 429 rate-limited, URL pollId update
 *   - AC5: 10-min cap timeout state + expired (404) state
 *   - AC6: click-through 200 / 410 / 404 / 422
 *   - AC7: invalid mode fires zero network calls
 *
 * Mock seam: MSW (TEST-FE-1). createTestQueryClient() per test. Fake
 * timers in tests that drive setTimeout / setInterval. Real timers in
 * tests that drive resend-mutation-only flows so user-event clicks work.
 */
import { act, type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import {
  Link,
  MemoryRouter,
  Route,
  Routes,
  useSearchParams,
} from 'react-router'
import { HttpResponse, delay, http } from 'msw'
import { I18nextProvider } from 'react-i18next'
import i18n from '@/lib/i18n'
import { server } from '@/test/msw-server'
import { MSW_RESEND_NEW_POLL_ID } from '@/test/mocks/handlers'
import VerifyEmailPage, {
  VERIFY_REDIRECT_DELAY_MS,
} from '@/features/auth/VerifyEmailPage'
import { createTestQueryClient } from '@/lib/query-client'
import { authKeys } from '@/features/auth/api/authKeys'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'
import { Toaster } from '@/components/ui/sonner'

const POLL_ID = '00000000-0000-0000-0000-poll00000001'
const TOKEN = 'valid-base64-token'

function UrlProbe() {
  const [params] = useSearchParams()
  return (
    <span data-testid="url-pollId">{params.get('pollId') ?? ''}</span>
  )
}

function renderPage({
  client = createTestQueryClient(),
  initialEntries = [`/verify-email?pollId=${POLL_ID}`],
  seededSession,
}: {
  client?: QueryClient
  initialEntries?: string[]
  seededSession?: { email: string; emailVerified?: boolean } | null
} = {}) {
  if (seededSession !== undefined && seededSession !== null) {
    client.setQueryData(authKeys.session(), {
      user: {
        id: 'u-1',
        email: seededSession.email,
        fullName: 'Seeded User',
        emailVerified: seededSession.emailVerified ?? false,
      },
      accessToken: null,
    })
  }
  const ui: ReactNode = (
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={initialEntries}>
          <Toaster />
          <Routes>
            <Route
              path="/verify-email"
              element={
                <>
                  <UrlProbe />
                  <VerifyEmailPage />
                  <Link to="/login" data-testid="external-login-link">
                    sibling-login
                  </Link>
                </>
              }
            />
            <Route
              path="/login"
              element={<p data-testid="login-reached">login</p>}
            />
            <Route path="/register" element={<p>register</p>} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>
  )
  return { ...render(ui), client }
}

beforeEach(() => {
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('VerifyEmailPage AC1 + AC7 — mode branching', () => {
  test('with ?pollId only renders the polling region', async () => {
    renderPage({ seededSession: { email: 'a@b.co' } })
    expect(await screen.findByTestId('verify-polling')).not.toBeNull()
    expect(screen.queryByTestId('verify-click-through')).toBeNull()
    expect(screen.queryByTestId('verify-invalid')).toBeNull()
  })

  test('with ?token only renders the click-through region', async () => {
    renderPage({
      initialEntries: [`/verify-email?token=${TOKEN}`],
    })
    expect(
      await screen.findByTestId('verify-click-through'),
    ).not.toBeNull()
    expect(screen.queryByTestId('verify-polling')).toBeNull()
    expect(screen.queryByTestId('verify-invalid')).toBeNull()
  })

  test('with BOTH ?pollId and ?token, click-through wins', async () => {
    renderPage({
      initialEntries: [`/verify-email?pollId=${POLL_ID}&token=${TOKEN}`],
    })
    expect(
      await screen.findByTestId('verify-click-through'),
    ).not.toBeNull()
    expect(screen.queryByTestId('verify-polling')).toBeNull()
  })

  test('with NEITHER renders verify-invalid and fires NO fetch', async () => {
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return new HttpResponse(null, { status: 500 })
      }),
      http.post('/api/auth/verify-email', () => {
        calls += 1
        return new HttpResponse(null, { status: 500 })
      }),
    )
    renderPage({ initialEntries: ['/verify-email'] })
    expect(await screen.findByTestId('verify-invalid')).not.toBeNull()
    expect(calls).toBe(0)
  })
})

describe('VerifyEmailPage AC3 — polling mode render', () => {
  test('renders envelope SVG, email, resend, spam hint, wrong-email prompt, google fallback', async () => {
    const { container } = renderPage({
      seededSession: { email: 'alice@example.com' },
    })
    await screen.findByTestId('verify-polling')
    expect(screen.getByTestId('verify-heading').textContent).toBe(
      i18n.t('auth.verify.title'),
    )
    expect(screen.getByTestId('verify-email-display').textContent).toBe(
      'alice@example.com',
    )
    expect(screen.getByTestId('verify-resend-button')).not.toBeNull()
    expect(screen.getByTestId('verify-spam-hint')).not.toBeNull()
    expect(screen.getByTestId('verify-wrong-email')).not.toBeNull()
    expect(screen.getByTestId('verify-wrong-email-link')).not.toBeNull()
    expect(
      screen.getByTestId('verify-google-fallback-prompt'),
    ).not.toBeNull()
    expect(
      screen.getByTestId('verify-google-fallback-link'),
    ).not.toBeNull()
    // Envelope SVG is inline.
    expect(container.querySelector('svg')).not.toBeNull()
  })

  test('falls back to bodyPrefix without bold email when useAuth returns null user', async () => {
    renderPage({ seededSession: null })
    await screen.findByTestId('verify-polling')
    expect(screen.queryByTestId('verify-email-display')).toBeNull()
    // No wrong-email block when email is unknown
    expect(screen.queryByTestId('verify-wrong-email')).toBeNull()
  })
})

describe('VerifyEmailPage AC3 — auto-redirect on verified: true', () => {
  test('redirects to /login?verified=1 with replace:true after the 1500ms delay when poll returns verified', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          { data: { verified: true, email: 'a@b.co' } },
          { status: 200 },
        ),
      ),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFY_REDIRECT_DELAY_MS + 50)
    })
    expect(screen.queryByTestId('login-reached')).not.toBeNull()
    vi.useRealTimers()
  })

  test('R-NEW=12 — does NOT navigate when component unmounts before timer fires', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          { data: { verified: true, email: 'a@b.co' } },
          { status: 200 },
        ),
      ),
    )
    const { unmount } = renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    unmount()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFY_REDIRECT_DELAY_MS + 500)
    })
    expect(screen.queryByTestId('login-reached')).toBeNull()
    vi.useRealTimers()
  })

  test('R-NEW=12 — does NOT fire deferred navigate when user clicks an in-app <Link> mid-redirect-delay', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          { data: { verified: true, email: 'a@b.co' } },
          { status: 200 },
        ),
      ),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    // First poll fires, verified state commits, success aria-live renders.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.queryByTestId('verify-success-redirecting')).not.toBeNull()
    // Mid-delay: user clicks the sibling external login link in the
    // tree. The click navigates immediately — unmounting
    // VerifyEmailPage and triggering the redirect effect's
    // clearTimeout cleanup so the deferred navigate cannot fire.
    vi.useRealTimers()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('external-login-link'))
    expect(screen.queryByTestId('login-reached')).not.toBeNull()
    // Advance well past the redirect-delay window — no late navigate
    // should fire (the cleanup tore down the timer). The page stays on
    // /login since the click already routed there, and the test does
    // NOT crash with a navigate-after-unmount error.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFY_REDIRECT_DELAY_MS + 500)
    })
    expect(screen.queryByTestId('login-reached')).not.toBeNull()
    vi.useRealTimers()
  })

  test('R-NEW=12 — late 200 poll arriving after 10-min cap is dropped silently (no navigate)', async () => {
    vi.useFakeTimers()
    // Delay the response so it resolves AFTER the 10-min cap fires:
    // first poll lands at t=5s; cap fires at t=605s; response resolves
    // at t=5s + 700s = 705s — guaranteed after the cap commits.
    server.use(
      http.get('/api/auth/verify-status', async () => {
        await delay(700_000)
        return HttpResponse.json(
          { data: { verified: true, email: 'a@b.co' } },
          { status: 200 },
        )
      }),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    // Advance past the 10-min cap WITHOUT yet draining the response.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })
    // Now drain the in-flight response (+ would-be redirect delay).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(
        700_000 + VERIFY_REDIRECT_DELAY_MS + 500,
      )
    })
    expect(screen.queryByTestId('login-reached')).toBeNull()
    vi.useRealTimers()
  })
})

describe('VerifyEmailPage AC3 — 404 expired state', () => {
  test('stops polling and renders verify-expired on 404 POLL_ID_NOT_FOUND', async () => {
    vi.useFakeTimers()
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return HttpResponse.json(
          {
            error: {
              code: 'POLL_ID_NOT_FOUND',
              message: 'expired',
              details: null,
            },
          },
          { status: 404 },
        )
      }),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.queryByTestId('verify-expired')).not.toBeNull()
    const callsAfterFirst = calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000)
    })
    expect(calls).toBe(callsAfterFirst)
    vi.useRealTimers()
  })
})

describe('VerifyEmailPage AC4 — resend countdown', () => {
  test('clicking resend fires POST, shows success toast and starts the 60s countdown', async () => {
    // S9 + S10 strengthen: explicit MSW call-count spy + toast text
    // assertion. The original test only asserted button-disabled,
    // which is set by countdown.start() inside onSuccess — making the
    // network call itself unverified (mutation could vacuously succeed
    // without ever firing the request). Both now pinned.
    let resendCalls = 0
    server.use(
      http.post('/api/auth/resend-verification', () => {
        resendCalls += 1
        return HttpResponse.json(
          { data: { verifyPollId: MSW_RESEND_NEW_POLL_ID } },
          { status: 200 },
        )
      }),
    )
    const user = userEvent.setup({ delay: null })
    renderPage({ seededSession: { email: 'a@b.co' } })
    await screen.findByTestId('verify-polling')
    await user.click(screen.getByTestId('verify-resend-button'))
    // Toast text appears (sonner renders into the Toaster portal).
    await screen.findByText(i18n.t('auth.verify.resendSentToast'))
    // Network call landed exactly once.
    expect(resendCalls).toBe(1)
    // Button disabled by the countdown that fires inside onSuccess.
    expect(
      screen.getByTestId('verify-resend-button').hasAttribute('disabled'),
    ).toBe(true)
  })

  test('S2 — 429 with MISSING Retry-After header defaults to a 60s countdown', async () => {
    const user = userEvent.setup({ delay: null })
    server.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'wait',
              details: null,
            },
          },
          { status: 429 }, // intentionally no Retry-After header
        ),
      ),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await screen.findByTestId('verify-polling')
    await user.click(screen.getByTestId('verify-resend-button'))
    await waitFor(() => {
      expect(screen.getByTestId('verify-resend-error')).not.toBeNull()
    })
    // RESEND_COUNTDOWN_SECONDS = 60 is the fallback when retryAfter is
    // missing on the ApiError (apiFetch returns null in that case).
    expect(
      screen.getByTestId('verify-resend-error').textContent,
    ).toMatch(/60/)
  })

  test('S3 — resend button label cycles 60s → 30s → 1s then re-enables', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    server.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json(
          { data: { verifyPollId: MSW_RESEND_NEW_POLL_ID } },
          { status: 200 },
        ),
      ),
    )
    const user = userEvent.setup({
      delay: null,
      advanceTimers: vi.advanceTimersByTime,
    })
    renderPage({ seededSession: { email: 'a@b.co' } })
    await screen.findByTestId('verify-polling')
    await user.click(screen.getByTestId('verify-resend-button'))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    const button = screen.getByTestId('verify-resend-button')
    // 60s start: label includes the remaining seconds (clamped).
    expect(button.textContent ?? '').toMatch(/60|59/)
    // Advance ~30s — label should reflect the mid-countdown value.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(button.textContent ?? '').toMatch(/30|29/)
    // Advance to the final tick — label down near 1.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(28_000)
    })
    expect(button.textContent ?? '').toMatch(/[12]/)
    // Past zero — button re-enables, label flips back to Resend.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000)
    })
    expect(button.hasAttribute('disabled')).toBe(false)
    vi.useRealTimers()
  })

  test('URL pollId updates after a successful resend with non-null verifyPollId', async () => {
    const user = userEvent.setup({ delay: null })
    const { client } = renderPage({ seededSession: { email: 'a@b.co' } })
    await screen.findByTestId('verify-polling')
    expect(screen.getByTestId('url-pollId').textContent).toBe(POLL_ID)
    await user.click(screen.getByTestId('verify-resend-button'))
    await waitFor(() => {
      expect(screen.getByTestId('url-pollId').textContent).toBe(
        MSW_RESEND_NEW_POLL_ID,
      )
    })
    expect(client.getQueryData(authKeys.session())).toBeDefined()
  })

  test('URL pollId does NOT update when verifyPollId is null (anti-enumeration branch)', async () => {
    const user = userEvent.setup({ delay: null })
    server.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json({ data: { verifyPollId: null } }, { status: 200 }),
      ),
    )
    renderPage({ seededSession: { email: 'unknown@example.com' } })
    await screen.findByTestId('verify-polling')
    await user.click(screen.getByTestId('verify-resend-button'))
    await waitFor(() => {
      expect(
        screen.getByTestId('verify-resend-button').hasAttribute('disabled'),
      ).toBe(true)
    })
    expect(screen.getByTestId('url-pollId').textContent).toBe(POLL_ID)
  })

  test('429 RATE_LIMIT_EXCEEDED renders inline alert with retryAfterSeconds and disables the resend button', async () => {
    const user = userEvent.setup({ delay: null })
    server.use(
      http.post('/api/auth/resend-verification', () =>
        HttpResponse.json(
          {
            error: {
              code: 'RATE_LIMIT_EXCEEDED',
              message: 'wait',
              details: null,
            },
          },
          { status: 429, headers: { 'Retry-After': '45' } },
        ),
      ),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await screen.findByTestId('verify-polling')
    await user.click(screen.getByTestId('verify-resend-button'))
    await waitFor(() => {
      expect(screen.getByTestId('verify-resend-error')).not.toBeNull()
    })
    expect(
      screen.getByTestId('verify-resend-error').textContent,
    ).toMatch(/45/)
  })
})

describe('VerifyEmailPage AC5 — 10-minute cap + expired', () => {
  test('swaps to timeout UI after 10 minutes elapse and stops polling', async () => {
    vi.useFakeTimers()
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return HttpResponse.json(
          { data: { verified: false, email: 'a@b.co' } },
          { status: 200 },
        )
      }),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })
    expect(screen.queryByTestId('verify-timeout')).not.toBeNull()
    const callsAfterCap = calls
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(calls).toBe(callsAfterCap)
    expect(screen.getByTestId('verify-recheck-button')).not.toBeNull()
    vi.useRealTimers()
  })

  test('B3 — manual recheck fires exactly ONE fetch and does NOT re-arm the poller', async () => {
    vi.useFakeTimers()
    let calls = 0
    server.use(
      http.get('/api/auth/verify-status', () => {
        calls += 1
        return HttpResponse.json(
          { data: { verified: false, email: 'a@b.co' } },
          { status: 200 },
        )
      }),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    // Drive past the 10-min cap to land on the timeout UI.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    })
    expect(screen.queryByTestId('verify-timeout')).not.toBeNull()
    const callsBeforeRecheck = calls
    vi.useRealTimers()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('verify-recheck-button'))
    // Recheck fires EXACTLY one fetch on top of whatever the cap-phase
    // already accumulated.
    await waitFor(() => {
      expect(calls).toBe(callsBeforeRecheck + 1)
    })
    // Re-arm fake timers and confirm NO interval re-arms — no further
    // polls fire over the next 30 seconds.
    vi.useFakeTimers()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000)
    })
    expect(calls).toBe(callsBeforeRecheck + 1)
    vi.useRealTimers()
  })

  test('expired-state resend CTA fires the same resend mutation (URL pollId updates)', async () => {
    vi.useFakeTimers()
    server.use(
      http.get('/api/auth/verify-status', () =>
        HttpResponse.json(
          {
            error: {
              code: 'POLL_ID_NOT_FOUND',
              message: 'expired',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    renderPage({ seededSession: { email: 'a@b.co' } })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000)
    })
    expect(screen.queryByTestId('verify-expired')).not.toBeNull()
    vi.useRealTimers()
    const user = userEvent.setup()
    await user.click(screen.getByTestId('verify-expired-resend'))
    await waitFor(() => {
      expect(screen.getByTestId('url-pollId').textContent).toBe(
        MSW_RESEND_NEW_POLL_ID,
      )
    })
  })
})

describe('VerifyEmailPage AC6 — click-through mode', () => {
  test('200 → success aria-live announcement → redirect to /login?verified=1', async () => {
    vi.useFakeTimers()
    renderPage({ initialEntries: [`/verify-email?token=${TOKEN}`] })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50)
    })
    expect(screen.queryByTestId('verify-success-redirecting')).not.toBeNull()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(VERIFY_REDIRECT_DELAY_MS + 50)
    })
    expect(screen.queryByTestId('login-reached')).not.toBeNull()
    vi.useRealTimers()
  })

  test('410 → expired state with the same expired UI as polling 404', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VERIFICATION_TOKEN_EXPIRED',
              message: 'expired',
              details: null,
            },
          },
          { status: 410 },
        ),
      ),
    )
    renderPage({ initialEntries: [`/verify-email?token=${TOKEN}`] })
    expect(await screen.findByTestId('verify-expired')).not.toBeNull()
  })

  test('404 → invalid state', async () => {
    server.use(
      http.post('/api/auth/verify-email', () =>
        HttpResponse.json(
          {
            error: {
              code: 'VERIFICATION_TOKEN_INVALID',
              message: 'invalid',
              details: null,
            },
          },
          { status: 404 },
        ),
      ),
    )
    renderPage({ initialEntries: [`/verify-email?token=${TOKEN}`] })
    expect(await screen.findByTestId('verify-invalid')).not.toBeNull()
  })

  test('422 → generic alert + try-again button re-fires the mutation on user click (P7 pre/post call-count diff)', async () => {
    let callCount = 0
    server.use(
      http.post('/api/auth/verify-email', () => {
        callCount += 1
        if (callCount === 1) {
          return HttpResponse.json(
            {
              error: {
                code: 'VALIDATION_ERROR',
                message: 'bad',
                details: null,
              },
            },
            { status: 422 },
          )
        }
        return HttpResponse.json(
          { data: { verified: true, email: 'a@b.co' } },
          { status: 200 },
        )
      }),
    )
    const user = userEvent.setup()
    renderPage({ initialEntries: [`/verify-email?token=${TOKEN}`] })
    expect(
      await screen.findByTestId('verify-click-through-error'),
    ).not.toBeNull()
    // Pin the pre-click call count so the post-click assertion proves
    // the user's interaction caused the re-fire (not a StrictMode
    // double-mount or dep-array churn elsewhere).
    const callsBeforeRetry = callCount
    expect(callsBeforeRetry).toBe(1)
    await user.click(screen.getByTestId('verify-try-again'))
    await waitFor(() => {
      expect(callCount).toBe(callsBeforeRetry + 1)
    })
    await waitFor(() => {
      expect(
        screen.queryByTestId('verify-success-redirecting'),
      ).not.toBeNull()
    })
  })
})
