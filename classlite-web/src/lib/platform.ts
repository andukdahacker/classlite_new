/**
 * platform — a capped host-platform detector for the ⌘K vs Ctrl K glyph swap
 * (Story 8-4b, D6).
 *
 * The CAP is deliberate: ONE platform read, ONE mac/not-mac decision. No per-OS
 * icon sets, no keyboard-layout heuristics — the sole consumer is the SearchPill
 * `<kbd>` hint, which renders `⌘K` on a Mac and `Ctrl K` everywhere else.
 */

/**
 * The modern user-agent-client-hints surface. Not yet in lib.dom.d.ts, so we
 * declare the one field we read. `userAgentData.platform` returns a friendly
 * name ("macOS", "Windows", "Linux") and is the non-deprecated successor to
 * `navigator.platform`.
 */
interface UserAgentDataLike {
  platform?: string
}

const MAC_PLATFORM_PATTERN = /mac/i

/**
 * isMacPlatform — true when the host is macOS (or iPadOS/iOS, which also match
 * `/mac/i` on modern Safari). Prefers `navigator.userAgentData.platform` and
 * falls back to the deprecated `navigator.platform`. SSR-guarded: returns false
 * when there is no `navigator` (the dashboard is a Vite SPA, but the guard keeps
 * the helper safe for any non-browser evaluation).
 */
export function isMacPlatform(): boolean {
  if (typeof navigator === 'undefined') return false
  // Justified assertion: `userAgentData` is not yet in the DOM lib types.
  const uaData = (navigator as Navigator & { userAgentData?: UserAgentDataLike })
    .userAgentData
  const platform = uaData?.platform ?? navigator.platform ?? ''
  return MAC_PLATFORM_PATTERN.test(platform)
}
