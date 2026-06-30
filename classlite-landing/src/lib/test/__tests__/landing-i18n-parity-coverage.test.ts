/**
 * landing-i18n-parity-coverage — Story 1.10 AC8 R38 Layer 3.
 *
 * Two related ratchets:
 *
 *   1. **Closed-enumeration meta-assertion (Murat M7)** — `STORY_1_10_KEYS`
 *      is the literal closed enumeration of every dot-path the landing
 *      site renders. It must match the keys flattened from `viStrings`
 *      one-to-one. Adding a key to `vi.ts`/`en.ts` without adding it
 *      to `STORY_1_10_KEYS` fails this test — closes the misattribution
 *      defense Layer 1 + Layer 4 alone do not catch.
 *
 *   2. **Orphan-key static scan** — every key in `STORY_1_10_KEYS` must
 *      be referenced at least once in some `.astro` file under
 *      `src/components/landing/**.astro` or `src/pages/**.astro`. A key
 *      that exists in the locale modules but no component uses is
 *      "orphan" — dead translation that costs reviewer time on every
 *      VN-fluent pass.
 *
 * Layer 4's `check-landing-parity.mjs` runs the same orphan scan as a
 * Node script for CI; this test runs it inside Vitest for local
 * iteration.
 *
 * The orphan check uses `test.fails` BEFORE the landing components
 * ship (Task 4). Once `src/components/landing/*.astro` reference every
 * key, switch `test.fails` → `test` (the spec is explicit about
 * red-first, green-once-components-land).
 */
import { describe, expect, test } from 'vitest'
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { strings as viStrings } from '../../../content/vi'

const PROJECT_ROOT = fileURLToPath(new URL('../../../..', import.meta.url))
const COMPONENTS_DIR = join(PROJECT_ROOT, 'src/components/landing')
const PAGES_DIR = join(PROJECT_ROOT, 'src/pages')

/**
 * STORY_1_10_KEYS — the closed enumeration. Every dot-path the
 * landing renders must appear here. Adding a key requires updating
 * BOTH the locale modules AND this array. Pinned 2026-06-30.
 */
export const STORY_1_10_KEYS = [
  // meta
  'meta.title',
  'meta.description',
  'meta.ogTitle',
  'meta.ogDescription',
  // header
  'header.cta',
  'header.nav.features',
  'header.nav.pricing',
  'header.nav.proof',
  'header.langToggleLabel',
  'header.hamburgerLabel',
  // hero
  'hero.eyebrow',
  'hero.headline',
  'hero.cta',
  // painCalculator
  'painCalculator.line1',
  'painCalculator.line2',
  'painCalculator.footnote',
  'painCalculator.moneyConversion',
  'painCalculator.assumption',
  // feature
  'feature.writing.title',
  'feature.writing.body',
  'feature.qa.title',
  'feature.qa.body',
  'feature.analytics.title',
  'feature.analytics.body',
  // socialProof
  'socialProof.sectionHeader',
  'socialProof.sectionNote',
  'socialProof.card1.center',
  'socialProof.card1.outcomeLabel',
  'socialProof.card1.outcomeValue',
  'socialProof.card1.quote',
  'socialProof.card1.attribution',
  'socialProof.card1.stats',
  'socialProof.card2.center',
  'socialProof.card2.outcomeLabel',
  'socialProof.card2.outcomeValue',
  'socialProof.card2.quote',
  'socialProof.card2.attribution',
  'socialProof.card2.stats',
  // pricing
  'pricing.heading',
  'pricing.toggleMonthly',
  'pricing.toggleAnnual',
  'pricing.annualBadge',
  'pricing.popularBadge',
  'pricing.free.name',
  'pricing.free.priceMonthly',
  'pricing.free.priceAnnual',
  'pricing.free.vatNote',
  'pricing.free.description',
  'pricing.free.cta',
  'pricing.pro.name',
  'pricing.pro.priceMonthly',
  'pricing.pro.priceAnnual',
  'pricing.pro.vatNote',
  'pricing.pro.description',
  'pricing.pro.cta',
  'pricing.studio.name',
  'pricing.studio.priceMonthly',
  'pricing.studio.priceAnnual',
  'pricing.studio.vatNote',
  'pricing.studio.description',
  'pricing.studio.cta',
  'pricing.belowCta',
  // footer
  'footer.tagline',
  'footer.product',
  'footer.legal',
  'footer.legalLinks.terms',
  'footer.legalLinks.privacy',
  'footer.legalLinks.zalo',
  'footer.copyright',
  // banner
  'banner.sessionExpired.body',
  'banner.sessionExpired.cta',
] as const

function flattenKeys(root: unknown, prefix = ''): string[] {
  if (root === null || typeof root !== 'object') return []
  const result: string[] = []
  for (const [key, value] of Object.entries(root)) {
    const path = prefix ? `${prefix}.${key}` : key
    if (value && typeof value === 'object') {
      result.push(...flattenKeys(value, path))
    } else {
      result.push(path)
    }
  }
  return result
}

function walkDir(dir: string, ext: string): string[] {
  if (!existsSync(dir)) return []
  const entries: string[] = []
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      entries.push(...walkDir(path, ext))
    } else if (path.endsWith(ext)) {
      entries.push(path)
    }
  }
  return entries
}

function collectReferencedKeys(): Set<string> {
  const files = [...walkDir(COMPONENTS_DIR, '.astro'), ...walkDir(PAGES_DIR, '.astro')]
  const referenced = new Set<string>()
  const re = /strings\.([a-zA-Z0-9_.]+)/g
  for (const file of files) {
    const source = readFileSync(file, 'utf8')
    let match: RegExpExecArray | null
    while ((match = re.exec(source)) !== null) {
      referenced.add(match[1])
    }
  }
  return referenced
}

describe('Story 1.10 landing i18n parity (R38) — closed enumeration (Murat M7)', () => {
  test('STORY_1_10_KEYS is identical to flattened viStrings keys (sorted)', () => {
    const fromLocale = flattenKeys(viStrings).sort()
    const fromEnumeration = [...STORY_1_10_KEYS].sort()
    expect(fromEnumeration).toEqual(fromLocale)
  })

  test('STORY_1_10_KEYS has no duplicates', () => {
    const set = new Set(STORY_1_10_KEYS)
    expect(set.size).toBe(STORY_1_10_KEYS.length)
  })
})

describe('Story 1.10 landing i18n parity (R38) — orphan key scan (enforcing)', () => {
  /* AC8 Layer 4 — every key in STORY_1_10_KEYS must be reachable from
     `src/components/landing/**.astro` or `src/pages/**.astro`, either
     directly (`strings.foo.bar` regex hit) OR via an ancestor that is
     passed as a subtree prop (`<PricingCard pricing={strings.pricing.free} />`
     reaches every descendant of `pricing.free`).

     The CI script `scripts/check-landing-parity.mjs` runs the same scan
     for non-developers; this test is the local-iteration mirror. P10
     from code review 2026-06-30 — previously a tautology
     (`expect(totalReached).toBeGreaterThanOrEqual(0)`). The
     `STORY_1_10_KEYS` ↔ `viStrings` symmetric meta-assertion above
     covers "key declared but not enumerated"; this assertion covers
     "key enumerated + declared but not actually rendered". */
  test('every STORY_1_10_KEYS entry is reachable from a landing .astro file', () => {
    const referenced = collectReferencedKeys()
    const orphans = STORY_1_10_KEYS.filter(
      (key) => !referenced.has(key) && !reachableViaSubtree(referenced, key),
    )
    expect(orphans).toEqual([])
  })
})

// A key like `pricing.free.priceMonthly` is "reachable" if a parent path
// such as `pricing.free` is referenced in source (the destructured prop
// pattern `<PricingCard pricing={strings.pricing.free} />` followed by
// `pricing.priceMonthly` inside the component).
function reachableViaSubtree(referenced: Set<string>, key: string): boolean {
  const segments = key.split('.')
  for (let i = segments.length - 1; i >= 1; i--) {
    const prefix = segments.slice(0, i).join('.')
    if (referenced.has(prefix)) return true
  }
  return false
}
