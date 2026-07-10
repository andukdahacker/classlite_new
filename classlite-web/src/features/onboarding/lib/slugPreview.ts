/**
 * slugifyPreview — Story 2-3a AC5, Task 2.3.
 *
 * Client-side mirror of `classlite-api/internal/service/slug.go::Slugify`. Both
 * MUST produce byte-identical output for the 10-entry canonical Vietnamese set
 * pinned in `slug_atdd_test.go:24-65`. Drift means the wizard promises
 * `X.classlite.app` and the server writes `Y.classlite.app`.
 *
 * Pipeline (per `slug.go` package doc):
 *   NFKC → NFD → strip combining marks → hard-map non-decomposing chars
 *        → lowercase → replace non-[a-z0-9] with '-' → collapse repeated '-'
 *        → trim '-' → truncate to 30 → trim trailing '-' again
 *
 * FU-2-3a-H tracks unifying the canonical set into a shared JSON fixture
 * consumed by both `slug.go` and this file.
 */

const SLUG_MAX_LEN = 30

// nonDecomposingDiacritics mirrors `slug.go`. Vietnamese `đ`/`Đ` are the
// load-bearing entries — every other Vietnamese tone is a combining mark that
// NFD strips. The Scandinavian `ø/Ø/æ/Æ` entries stay in sync with the Go map.
const NON_DECOMPOSING_DIACRITICS: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
}

export function slugifyPreview(name: string): string {
  // 1. NFKC first — collapse compat forms (fullwidth ASCII, etc.).
  let s = name.normalize('NFKC')
  // 2. NFD decomposes base + combining marks; strip the marks and hard-map
  //    non-decomposing diacritics.
  s = s.normalize('NFD')
  let mapped = ''
  for (const ch of s) {
    // Combining marks land in U+0300–U+036F (and a handful of higher blocks,
    // but Vietnamese + Latin coverage is captured here).
    if (/\p{M}/u.test(ch)) continue
    const nonDecomp = NON_DECOMPOSING_DIACRITICS[ch]
    if (nonDecomp !== undefined) {
      mapped += nonDecomp
      continue
    }
    mapped += ch
  }
  s = mapped.toLowerCase()

  // 3. Replace anything not [a-z0-9] with '-'.
  let out = ''
  for (const ch of s) {
    const code = ch.charCodeAt(0)
    const isAsciiLower = code >= 97 && code <= 122
    const isAsciiDigit = code >= 48 && code <= 57
    out += isAsciiLower || isAsciiDigit ? ch : '-'
  }
  s = out

  // 4. Collapse `--+` to single `-` and trim.
  while (s.includes('--')) {
    s = s.split('--').join('-')
  }
  s = trimHyphens(s)

  // 5. Truncate to SLUG_MAX_LEN and trim trailing hyphen exposed by the cut.
  if (s.length > SLUG_MAX_LEN) {
    s = s.slice(0, SLUG_MAX_LEN)
  }
  s = s.replace(/-+$/, '')

  return s
}

function trimHyphens(value: string): string {
  return value.replace(/^-+/, '').replace(/-+$/, '')
}
