/**
 * Route matching helpers — shared between `MobileTabBar` and the consumer
 * `AppLayout` so deep routes (e.g. `/classes/123`) correctly highlight
 * the closest nav entry. Story 1d-3 code-review D6 closure.
 *
 * Exact-match would miss deep routes; `startsWith` would falsely match
 * `/classes` against `/classes-archived`. Longest-prefix is the correct
 * shape: a tab href matches if the pathname equals it OR is followed by
 * a slash; the LONGEST such match wins. Root `/` matches only itself.
 */
export function matchLongestHrefPrefix(
  pathname: string,
  hrefs: readonly string[],
): string | null {
  let bestMatch: string | null = null
  let bestLength = -1
  for (const href of hrefs) {
    if (!isPrefixMatch(pathname, href)) continue
    if (href.length > bestLength) {
      bestMatch = href
      bestLength = href.length
    }
  }
  return bestMatch
}

function isPrefixMatch(pathname: string, href: string): boolean {
  if (pathname === href) return true
  // Root path `/` would falsely match every other path under the
  // `startsWith` rule; require an exact match for it.
  if (href === '/') return pathname === '/'
  return pathname.startsWith(href + '/')
}
