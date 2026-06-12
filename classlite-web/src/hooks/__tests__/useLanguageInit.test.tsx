/**
 * useLanguageInit — cookie seed + subscription bridge (Story 1-7c AC6).
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { render } from '@testing-library/react'
import { useLanguageInit } from '@/hooks/useLanguageInit'
import { useLanguageStore } from '@/stores/languageStore'
import i18n from '@/lib/i18n'

function clearCookies(): void {
  document.cookie
    .split(';')
    .map((c) => c.trim().split('=')[0])
    .filter(Boolean)
    .forEach((name) => {
      document.cookie = `${name}=; Max-Age=0; Path=/`
    })
}

function Harness() {
  useLanguageInit()
  return null
}

describe('useLanguageInit', () => {
  beforeEach(() => {
    clearCookies()
    // TEST-FE-3 amendment: use the `.reset()` action so Zustand v5's
    // action surface stays intact.
    useLanguageStore.getState().reset()
    // Reset i18n.language to en between tests via the actual API.
    void i18n.changeLanguage('en')
  })

  afterEach(() => {
    clearCookies()
  })

  test('seeds the store from a lang=vi cookie on mount', async () => {
    document.cookie = 'lang=vi; Path=/'
    render(<Harness />)
    expect(useLanguageStore.getState().language).toBe('vi')
    // i18n.changeLanguage is async via a Promise; give the microtask
    // queue a tick.
    await Promise.resolve()
    expect(i18n.language).toBe('vi')
  })

  test('leaves the store at en when no cookie is present', () => {
    render(<Harness />)
    expect(useLanguageStore.getState().language).toBe('en')
  })

  test('cross-tab: BroadcastChannel message updates store without re-writing cookie', async () => {
    if (typeof BroadcastChannel === 'undefined') {
      return // skip in environments without BroadcastChannel
    }
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
      render(<Harness />)
      const remote = new BroadcastChannel('classlite.lang')
      try {
        // Wait for the store to reflect the broadcast — jsdom queues
        // BroadcastChannel deliveries on the macrotask queue, so the
        // observable lands on a later tick than the immediate await.
        remote.postMessage('vi')
        await vi.waitFor(
          () => {
            expect(useLanguageStore.getState().language).toBe('vi')
          },
          { timeout: 500, interval: 10 },
        )
        // No `lang=...` cookie write — the originating tab already wrote
        // it; the receiver must not re-write or a ping-pong loop forms.
        const langWrites = setterSpy.mock.calls
          .map((args) => args[0] as string)
          .filter((value) => value.startsWith('lang='))
        expect(langWrites.length).toBe(0)
      } finally {
        remote.close()
      }
    } finally {
      if (cookieDescriptor) {
        Object.defineProperty(document, 'cookie', cookieDescriptor)
      }
    }
  })

  test('writes the cookie + flips i18n on subsequent setLanguage', async () => {
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
      render(<Harness />)
      // After mount, subscriber is active. Trigger a store mutation.
      useLanguageStore.getState().setLanguage('vi')
      await Promise.resolve()
      // At least one cookie write that contains "lang=vi".
      const writes = setterSpy.mock.calls
        .map((args) => args[0] as string)
        .filter((value) => value.startsWith('lang=vi'))
      expect(writes.length).toBeGreaterThan(0)
      expect(i18n.language).toBe('vi')
    } finally {
      if (cookieDescriptor) {
        Object.defineProperty(document, 'cookie', cookieDescriptor)
      }
    }
  })
})
