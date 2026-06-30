/**
 * useHintCookieWrite — Story 1.10 Task 2 (AC4c + AC4d).
 *
 * The dashboard half of UX-DR18. When `useAuth().isAuthenticated` is
 * true, the hook writes `logged_in=1` on `.classlite.app` so the Astro
 * landing site's `<script is:inline>` short-circuits authenticated
 * visitors to the dashboard.
 *
 * Mock seam: NONE — this hook is silent side-effect on `document.cookie`.
 * Tests spy on the cookie setter (same pattern as `LoginPage.test.tsx:1038`
 * Murat M5) and the BroadcastChannel listener (same pattern as
 * `auth-refresh-locks.test.ts:220`).
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest'
import { StrictMode, type ReactNode } from 'react'
import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { queryClient as productionQueryClient } from '@/lib/query-client'
import { useHintCookieWrite } from '@/hooks/useHintCookieWrite'

function Probe(): null {
  useHintCookieWrite()
  return null
}

function makeClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  })
}

function mountProbe(client: QueryClient, strict = false): { unmount: () => void } {
  const ui: ReactNode = (
    <QueryClientProvider client={client}>
      {strict ? (
        <StrictMode>
          <Probe />
        </StrictMode>
      ) : (
        <Probe />
      )}
    </QueryClientProvider>
  )
  return render(ui)
}

const AUTHED_SESSION: Session = {
  user: {
    id: 'user-1',
    email: 'duc@kovernow.com',
    fullName: 'Duc Do',
    emailVerified: true,
  },
  accessToken: 'jwt.test',
}

const UNVERIFIED_SESSION: Session = {
  user: {
    ...AUTHED_SESSION.user,
    emailVerified: false,
  },
  accessToken: null,
}

function mockHostname(host: string): { restore: () => void } {
  const original = Object.getOwnPropertyDescriptor(window, 'location')
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, hostname: host },
  })
  return {
    restore: () => {
      if (original) Object.defineProperty(window, 'location', original)
    },
  }
}

function spyOnCookieSetter(): {
  setSpy: ReturnType<typeof vi.fn>
  restore: () => void
} {
  const setSpy = vi.fn()
  const originalDescriptor = Object.getOwnPropertyDescriptor(
    Document.prototype,
    'cookie',
  )
  Object.defineProperty(document, 'cookie', {
    configurable: true,
    set: setSpy,
    get: () => '',
  })
  return {
    setSpy,
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(Document.prototype, 'cookie', originalDescriptor)
      }
    },
  }
}

const isLoggedInWrite = (call: unknown[]): boolean => {
  const raw = call[0]
  if (typeof raw !== 'string') return false
  if (!raw.startsWith('logged_in=1')) return false
  if (!raw.includes('Max-Age=31536000')) return false
  return true
}

const isLoggedInWriteForProductionDomain = (call: unknown[]): boolean => {
  const raw = call[0]
  if (typeof raw !== 'string') return false
  if (!raw.startsWith('logged_in=1')) return false
  if (!raw.includes('Max-Age=31536000')) return false
  if (!raw.includes('Domain=.classlite.app')) return false
  if (!raw.includes('Path=/')) return false
  if (!raw.includes('SameSite=Lax')) return false
  return true
}

describe('useHintCookieWrite — write triggered by isAuthenticated', () => {
  let hostRestore: { restore: () => void } | null = null
  let cookieRestore: { restore: () => void } | null = null

  beforeEach(() => {
    hostRestore = mockHostname('my.classlite.app')
  })

  afterEach(() => {
    if (hostRestore) {
      hostRestore.restore()
      hostRestore = null
    }
    if (cookieRestore) {
      cookieRestore.restore()
      cookieRestore = null
    }
  })

  test('does NOT write when isAuthenticated is false (no session in cache)', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    mountProbe(client)
    expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(0)
  })

  test('does NOT write when user is unverified (emailVerified=false)', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), UNVERIFIED_SESSION)
    mountProbe(client)
    expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(0)
  })

  test('writes cookie when isAuthenticated transitions false → true via setQueryData', async () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    mountProbe(client)
    expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(0)
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    await waitFor(() => {
      expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(1)
    })
  })

  test('writes cookie on first mount when isAuthenticated is already true', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    mountProbe(client)
    expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(1)
  })

  test('byte-exact write predicate matches the cross-codebase fixture contract', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    mountProbe(client)
    const matching = setSpy.mock.calls.filter(
      isLoggedInWriteForProductionDomain,
    )
    expect(matching.length).toBe(1)
  })

  test('Domain attribute matches computeCookieDomain for localhost (no Domain)', () => {
    hostRestore?.restore()
    hostRestore = mockHostname('localhost')
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    mountProbe(client)
    const matching = setSpy.mock.calls.filter(isLoggedInWrite)
    expect(matching.length).toBe(1)
    const written = matching[0]?.[0] as string
    expect(written).not.toContain('Domain=')
  })

  test('StrictMode pass-2 within ONE mount: cookie write fires exactly ONCE', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    mountProbe(client, /* strict */ true)
    const matching = setSpy.mock.calls.filter(isLoggedInWrite)
    expect(matching.length).toBe(1)
  })

  test('re-asserts on every fresh mount when isAuthenticated is true', () => {
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    const client = makeClient()
    client.setQueryData(authKeys.session(), AUTHED_SESSION)
    const first = mountProbe(client)
    first.unmount()
    const second = mountProbe(client)
    second.unmount()
    const matching = setSpy.mock.calls.filter(isLoggedInWrite)
    expect(matching.length).toBe(2)
  })

  test('cross-tab BroadcastChannel login-succeeded triggers the cookie write', async () => {
    // The production `auth-refresh.ts` BroadcastChannel listener writes
    // to the module-level `queryClient`, NOT the per-test client. Use
    // the production client here so the broadcast → cache → useAuth →
    // useHintCookieWrite chain wires end-to-end.
    productionQueryClient.removeQueries({ queryKey: authKeys.session() })
    const { setSpy, restore } = spyOnCookieSetter()
    cookieRestore = { restore }
    mountProbe(productionQueryClient)
    expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(0)

    const sibling = new BroadcastChannel('classlite_auth')
    sibling.postMessage({
      type: 'login-succeeded',
      timestamp: 1700000000,
      data: AUTHED_SESSION,
    })
    /* P28 — use Testing Library `waitFor` instead of a fixed 50 ms
       sleep. The 50 ms was flake-prone on slow CI runners; `waitFor`
       polls until the assertion passes (or its 1 s default timeout). */
    await waitFor(() => {
      expect(setSpy.mock.calls.filter(isLoggedInWrite).length).toBe(1)
    })
    sibling.close()
    productionQueryClient.removeQueries({ queryKey: authKeys.session() })
  })
})
