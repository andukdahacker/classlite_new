/**
 * getInitials — Story 2-3a AC5, Task 2.4.
 *
 * Extracts the letter-mark preview for the center-name branding tile. See
 * `letterMark.test.ts` for the canonical behavior contract.
 *
 * Multi-token (≥2 tokens): first two tokens each contribute one letter — the
 * first grapheme passing `\p{L}` after NFD-strip + Vietnamese `đ→d`. Tokens
 * with no `\p{L}` grapheme (emoji-only, punctuation-only) fall back to `?` for
 * that slot only (Sally-I3 fold).
 *
 * Single-token: take up to two `\p{L}` graphemes from the token itself (drops
 * `ClassLite → CL`). Punctuation and non-letter characters between letters
 * are SKIPPED — `getInitials('X.Y') → 'XY'` (R1-P20). NO `?` fallback here —
 * a single decorative-only token (`!!!`, `🎉`) returns empty string, which
 * the page renders as the border-dashed pristine tile per AC5 (Sally-I7 fold).
 *
 * Asymmetry note (R1-P21): a single pure-emoji token returns `''` (pristine),
 * but a multi-token starting with emoji returns `?<second>`. Intentional —
 * the pristine tile is the correct answer when the user has typed nothing
 * a letter-mark can reasonably represent.
 *
 * Zero tokens / whitespace-only → empty string.
 */

const NON_DECOMPOSING_DIACRITICS: Record<string, string> = {
  đ: 'd',
  Đ: 'D',
  ø: 'o',
  Ø: 'O',
  æ: 'ae',
  Æ: 'AE',
}

export function getInitials(name: string): string {
  const trimmed = name.trim()
  if (trimmed.length === 0) return ''

  const tokens = trimmed.split(/\s+/).filter((token) => token.length > 0)
  if (tokens.length === 0) return ''

  if (tokens.length === 1) {
    return extractSingleTokenInitials(tokens[0])
  }

  const first = firstLetterOrFallback(tokens[0])
  const second = firstLetterOrFallback(tokens[1])
  return first + second
}

/** Multi-token slot: first `\p{L}` grapheme after strip, uppercased. Emoji /
 * punctuation-only token → `?`. */
function firstLetterOrFallback(token: string): string {
  for (const ch of token) {
    const stripped = stripDiacritic(ch)
    if (/\p{L}/u.test(stripped)) {
      return stripped.toUpperCase()
    }
  }
  return '?'
}

/** Single-token branch: take up to two `\p{L}` graphemes from the token.
 * No `?` fallback — empty tokens return empty string so the page can render the
 * pristine border-dashed tile. */
function extractSingleTokenInitials(token: string): string {
  let out = ''
  for (const ch of token) {
    const stripped = stripDiacritic(ch)
    if (/\p{L}/u.test(stripped)) {
      out += stripped.toUpperCase()
      if (out.length === 2) break
    }
  }
  return out
}

/** NFD-decompose, drop combining marks, hard-map `đ/Đ/ø/Ø/æ/Æ`. Mirrors the
 * `slugPreview` pipeline so the letter-mark reads like the slug's first letter. */
function stripDiacritic(ch: string): string {
  const decomposed = ch.normalize('NFD')
  let result = ''
  for (const c of decomposed) {
    if (/\p{M}/u.test(c)) continue
    const mapped = NON_DECOMPOSING_DIACRITICS[c]
    if (mapped !== undefined) {
      result += mapped
      continue
    }
    result += c
  }
  return result
}
