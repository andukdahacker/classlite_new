// Story 8-4b, Task 1 (AC3, D6) — the CAPPED platform detector backing the
// ⌘K vs Ctrl K glyph swap on the SearchPill. RED-FIRST: `@/lib/platform` does
// not exist yet (TS2307).
//
// The cap (D6): ONE platform read, ONE glyph decision. No per-OS icon sets, no
// keyboard-layout heuristics. The detector prefers `navigator.userAgentData.platform`
// (the modern, non-deprecated signal) and falls back to `navigator.platform`.
import { afterEach, describe, expect, test, vi } from 'vitest'
import { isMacPlatform } from '@/lib/platform'

interface UADataLike {
  platform: string
}

function stubNavigator(overrides: {
  platform?: string
  userAgentData?: UADataLike
}): void {
  vi.stubGlobal('navigator', {
    platform: overrides.platform ?? '',
    userAgentData: overrides.userAgentData,
  })
}

describe('isMacPlatform', () => {
  afterEach(() => vi.unstubAllGlobals())

  test('true for a Mac via navigator.platform', () => {
    stubNavigator({ platform: 'MacIntel' })
    expect(isMacPlatform()).toBe(true)
  })

  test('false for Windows via navigator.platform', () => {
    stubNavigator({ platform: 'Win32' })
    expect(isMacPlatform()).toBe(false)
  })

  test('false for Linux via navigator.platform', () => {
    stubNavigator({ platform: 'Linux x86_64' })
    expect(isMacPlatform()).toBe(false)
  })

  test('prefers userAgentData.platform when present ("macOS")', () => {
    // userAgentData says macOS even though the deprecated platform is blank.
    stubNavigator({ platform: '', userAgentData: { platform: 'macOS' } })
    expect(isMacPlatform()).toBe(true)
  })

  test('userAgentData "Windows" wins over a stale platform string', () => {
    stubNavigator({ platform: 'MacIntel', userAgentData: { platform: 'Windows' } })
    expect(isMacPlatform()).toBe(false)
  })
})
