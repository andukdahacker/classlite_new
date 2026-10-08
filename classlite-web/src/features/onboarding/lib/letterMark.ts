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

/* eslint-disable no-restricted-syntax -- a WCAG contrast utility: raw hex is its
   domain. It reads the (hex) brand-color palette and returns a legible dark/white
   foreground. The two foreground literals are not themable design surfaces — they
   are the black/white contrast anchors the algorithm chooses between. */
/**
 * readableTextColor — pick a WCAG-legible foreground (dark slate or white) for
 * text drawn on a solid `backgroundHex`. Uses the relative-luminance crossover
 * (~0.179) where black and white give equal contrast: lighter backgrounds get
 * dark text, darker backgrounds get white. Fixes the letter-mark chip, whose
 * hardcoded white text failed contrast on the mid-tone brand colors (e.g. the
 * default amber `#d97706` → 3.2:1). Accepts `#rgb` / `#rrggbb`.
 */
const DARK_TEXT = '#0f172a' // slate-900
const LIGHT_TEXT = '#ffffff'
const LUMINANCE_CROSSOVER = 0.179

export function readableTextColor(backgroundHex: string): string {
  const rgb = parseHex(backgroundHex)
  if (rgb === null) return LIGHT_TEXT
  const toLinear = (channel: number): number => {
    const value = channel / 255
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  const luminance =
    0.2126 * toLinear(rgb.r) + 0.7152 * toLinear(rgb.g) + 0.0722 * toLinear(rgb.b)
  return luminance > LUMINANCE_CROSSOVER ? DARK_TEXT : LIGHT_TEXT
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(hex.trim())
  if (match === null) return null
  let body = match[1]
  if (body.length === 3) {
    body = body
      .split('')
      .map((c) => c + c)
      .join('')
  }
  return {
    r: parseInt(body.slice(0, 2), 16),
    g: parseInt(body.slice(2, 4), 16),
    b: parseInt(body.slice(4, 6), 16),
  }
}
/* eslint-enable no-restricted-syntax */

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
