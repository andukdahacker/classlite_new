/**
 * stubLocation — replace window.location with a configurable test double,
 * returning a cleanup handle.
 *
 * jsdom 29's `Location.assign` is non-configurable, so `vi.spyOn(window.location,
 * 'assign')` throws. The dashboard's 401 silent-refresh path calls
 * `window.location.assign('/login?session_expired=1')` to redirect on
 * refresh failure (auth-refresh.ts → onAuthFailure). Tests need to assert
 * the redirect target without actually navigating, so we replace the
 * whole location with a plain object that exposes only the surface area
 * production code touches.
 *
 * `restore()` puts the original `window.location` back. Call it in
 * `afterEach` so the next test starts with the real Location and a test
 * that opts out of the stub doesn't inherit the previous test's `vi.fn()`.
 */
import { vi } from 'vitest'

type Mock = ReturnType<typeof vi.fn>

export interface StubbedLocation {
  assign: Mock
  pathname: string
  search: string
  href: string
  origin: string
  host: string
  hostname: string
  port: string
  protocol: string
  hash: string
  restore: () => void
}

export function stubLocation(): StubbedLocation {
  const originalLocation = window.location
  const stub = {
    assign: vi.fn(),
    pathname: '/',
    search: '',
    href: 'http://localhost:5173/',
    origin: 'http://localhost:5173',
    host: 'localhost:5173',
    hostname: 'localhost',
    port: '5173',
    protocol: 'http:',
    hash: '',
  }
  Object.defineProperty(window, 'location', {
    configurable: true,
    writable: true,
    value: stub,
  })
  const restore = () => {
    Object.defineProperty(window, 'location', {
      configurable: true,
      writable: true,
      value: originalLocation,
    })
  }
  return { ...stub, restore }
}
