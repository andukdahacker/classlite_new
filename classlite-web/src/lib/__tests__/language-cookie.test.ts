/**
 * language-cookie — UX-DR17 cookie read / write / domain (Story 1-7c AC6).
 */
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  languageCookieDomain,
  readLanguageCookie,
  writeLanguageCookie,
  type Language,
} from '@/lib/language-cookie'

function clearCookies(): void {
  // jsdom's document.cookie store is overwriteable; max-age=0 expires
  // a cookie effectively immediately. Loop over every cookie that
  // exists so we leave a clean slate for each test.
  document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean)
    .forEach((name) => {
      document.cookie = `${name}=; Max-Age=0; Path=/`
    })
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

describe('readLanguageCookie', () => {
  afterEach(clearCookies)

  test('returns null when no lang cookie is present', () => {
    expect(readLanguageCookie()).toBeNull()
  })

  test('round-trips a written en value', () => {
    writeLanguageCookie('en')
    expect(readLanguageCookie()).toBe('en')
  })

  test('round-trips a written vi value', () => {
    writeLanguageCookie('vi')
    expect(readLanguageCookie()).toBe('vi')
  })

  test('returns null for a malformed value (e.g., garbage)', () => {
    document.cookie = 'lang=garbage; Path=/'
    expect(readLanguageCookie()).toBeNull()
  })

  test('extracts the lang value when surrounded by other cookies', () => {
    document.cookie = 'session_id=abc; Path=/'
    document.cookie = 'csrf=xyz; Path=/'
    writeLanguageCookie('vi' as Language)
    expect(readLanguageCookie()).toBe('vi')
  })
})

describe('languageCookieDomain', () => {
  test('returns .classlite.app for a my.classlite.app host', () => {
    const restore = mockHostname('my.classlite.app')
    try {
      expect(languageCookieDomain()).toBe('.classlite.app')
    } finally {
      restore.restore()
    }
  })

  test('returns .classlite.app for the bare classlite.app host', () => {
    const restore = mockHostname('classlite.app')
    try {
      expect(languageCookieDomain()).toBe('.classlite.app')
    } finally {
      restore.restore()
    }
  })

  test('returns .classlite.localhost for a my.classlite.localhost host', () => {
    const restore = mockHostname('my.classlite.localhost')
    try {
      expect(languageCookieDomain()).toBe('.classlite.localhost')
    } finally {
      restore.restore()
    }
  })

  test('returns null for bare localhost (jsdom default)', () => {
    const restore = mockHostname('localhost')
    try {
      expect(languageCookieDomain()).toBeNull()
    } finally {
      restore.restore()
    }
  })

  test('returns null for an unrelated host', () => {
    const restore = mockHostname('example.com')
    try {
      expect(languageCookieDomain()).toBeNull()
    } finally {
      restore.restore()
    }
  })
})

describe('writeLanguageCookie', () => {
  afterEach(clearCookies)

  test('writes Path=/ + SameSite=Lax + Max-Age (1 year)', () => {
    const setterSpy = vi.fn()
    const cookieDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'cookie',
    )
    Object.defineProperty(document, 'cookie', {
      configurable: true,
      get: () => '',
      set: (value: string) => setterSpy(value),
    })
    try {
      writeLanguageCookie('vi')
      const written = setterSpy.mock.calls[0]?.[0] as string | undefined
      expect(written).toContain('lang=vi')
      expect(written).toContain('Path=/')
      expect(written).toContain('SameSite=Lax')
      expect(written).toMatch(/Max-Age=\d+/)
    } finally {
      if (cookieDescriptor) {
        Object.defineProperty(document, 'cookie', cookieDescriptor)
      }
    }
  })
})
