/**
 * cookie-domain — shared Domain-attribute helper for the lang + logged_in
 * cookies (Story 1.10 Task 1).
 *
 * The lang cookie (Story 1-7c) and the hint cookie (Story 1.10 Task 2)
 * both need to be set on `.classlite.app` / `.classlite.localhost` so
 * the landing site at `classlite.app` and the dashboard at
 * `my.classlite.app` share them. Both consumers route through
 * `computeCookieDomain` so the contract stays in one place.
 */
import { afterEach, describe, expect, test } from 'vitest'
import { computeCookieDomain } from '@/lib/cookie-domain'

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

describe('computeCookieDomain', () => {
  let activeRestore: { restore: () => void } | null = null

  afterEach(() => {
    if (activeRestore) {
      activeRestore.restore()
      activeRestore = null
    }
  })

  test('returns .classlite.app for the bare classlite.app host', () => {
    activeRestore = mockHostname('classlite.app')
    expect(computeCookieDomain()).toBe('.classlite.app')
  })

  test('returns .classlite.app for a my.classlite.app subdomain', () => {
    activeRestore = mockHostname('my.classlite.app')
    expect(computeCookieDomain()).toBe('.classlite.app')
  })

  test('returns .classlite.localhost for the bare classlite.localhost host', () => {
    activeRestore = mockHostname('classlite.localhost')
    expect(computeCookieDomain()).toBe('.classlite.localhost')
  })

  test('returns .classlite.localhost for a my.classlite.localhost subdomain', () => {
    activeRestore = mockHostname('my.classlite.localhost')
    expect(computeCookieDomain()).toBe('.classlite.localhost')
  })

  test('returns null for bare localhost (jsdom default)', () => {
    activeRestore = mockHostname('localhost')
    expect(computeCookieDomain()).toBeNull()
  })

  test('returns null for an unrelated host', () => {
    activeRestore = mockHostname('example.com')
    expect(computeCookieDomain()).toBeNull()
  })
})

describe('computeCookieDomain — SSR / no-window guard', () => {
  test('returns null when window is undefined (SSR / jsdom-less)', async () => {
    const originalWindow = globalThis.window
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: undefined,
    })
    try {
      const { computeCookieDomain: ssrSafe } = await import(
        '@/lib/cookie-domain'
      )
      expect(ssrSafe()).toBeNull()
    } finally {
      Object.defineProperty(globalThis, 'window', {
        configurable: true,
        value: originalWindow,
      })
    }
  })
})
