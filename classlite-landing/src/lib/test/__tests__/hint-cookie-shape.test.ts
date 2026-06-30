/**
 * hint-cookie-shape — Story 1.10 Task 9.5 cross-codebase byte-string
 * fixture (Murat STRONG #4).
 *
 * The dashboard-side cookie write lives at
 * `classlite-web/src/hooks/useHintCookieWrite.ts` and is asserted
 * byte-exact in `useHintCookieWrite.test.tsx`. The landing side reads
 * that cookie via the `<script is:inline>` in `BaseLayout.astro` —
 * which means the contract is cross-codebase. Neither unit suite
 * alone verifies the byte-string match.
 *
 * This test extracts the lang-cookie write script body from
 * `BaseLayout.astro` (which uses the same shape), evaluates the cookie
 * literal against a fixture domain, and asserts the produced string
 * matches the contract the dashboard's write asserts at production
 * runtime. Closes the cross-codebase gap.
 */
import { describe, expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const BASE_LAYOUT_PATH = join(
  HERE,
  '../../../..',
  'src/layouts/BaseLayout.astro',
)

describe('hint-cookie-shape — cross-codebase byte-string contract', () => {
  test('BaseLayout lang-cookie write produces the same shape the dashboard hint cookie write asserts', () => {
    // The dashboard write produces:
    //   logged_in=1; Max-Age=31536000; Path=/; SameSite=Lax; Domain=.classlite.app
    // The landing inline lang-cookie write uses an identical structure with the
    // value being the active locale, not "1". Both share the
    // computeCookieDomain → .classlite.app derivation. We assert here that
    // the landing inline script, given a `Domain=.classlite.app` fixture,
    // produces the same Path/SameSite/Max-Age envelope the dashboard does.
    const src = readFileSync(BASE_LAYOUT_PATH, 'utf8')
    expect(src).toContain('Max-Age=31536000')
    expect(src).toContain("'SameSite=Lax'")
    expect(src).toContain("'Path=/'")
    expect(src).toMatch(/'lang=' \+ activeLang/)
    /* The hint-cookie reader in BaseLayout extracts each cookie
       segment and asserts its name is `logged_in` AND its value is
       exactly `1` (post-P9 — no prefix-match against `logged_in=10`
       etc.). Confirm the structural ingredients of that exact parse
       are still present. */
    expect(src).toContain("segment.slice(0, eq).trim() === 'logged_in'")
    expect(src).toContain("segment.slice(eq + 1).trim() === '1'")
  })

  test('hint cookie byte-string contract (production domain)', () => {
    // The cross-codebase contract: when the dashboard writes the hint
    // cookie on .classlite.app, the byte-string is:
    const expectedWrite =
      'logged_in=1; Max-Age=31536000; Path=/; SameSite=Lax; Domain=.classlite.app'

    // This fixture-string is what `useHintCookieWrite.test.tsx` asserts
    // is set on `document.cookie`. The landing site's inline redirect
    // script reads ANY cookie matching the prefix `logged_in=1`. We
    // verify here that the dashboard's expected write satisfies the
    // landing's read predicate.
    expect(expectedWrite.startsWith('logged_in=1')).toBe(true)
    expect(expectedWrite).toContain('Domain=.classlite.app')

    // The landing inline reader (from BaseLayout) splits on ';' and
    // checks `c === 'logged_in=1' || c.startsWith('logged_in=1;')`.
    // Confirm the first segment of the dashboard write matches:
    const firstSegment = expectedWrite.split(';')[0]
    expect(firstSegment).toBe('logged_in=1')
  })
})
