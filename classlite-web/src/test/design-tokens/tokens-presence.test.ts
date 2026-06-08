/// <reference types="node" />
/**
 * Token presence + value contract (AC1 + AC7 for Story 1.7a).
 *
 * Reads `src/tokens.css` from disk, parses the `:root` block, and asserts
 * every canonical UX-spec token is declared with the exact expected value.
 * Drift in any token value, name, or set is a regression that downstream
 * Epic 1C/1D stories silently inherit.
 *
 * Why this guard is non-negotiable per Story 1.7a Dev Notes: Storybook
 * (1d-1) and every primitive in Epic 1D consume these tokens directly via
 * the shadcn theme bridge. A wrong value or missing token here flips into
 * a class of "looks fine, fails WCAG audit" defects.
 */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'

const TOKENS_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../../tokens.css',
)

const EXPECTED_TOKENS: Record<string, string> = {
  // Surfaces
  '--cl-paper': '#f5f1ea',
  '--cl-paper-2': '#efe9df',
  '--cl-surface': '#ffffff',
  '--cl-surface-warm': '#fcfaf6',
  '--cl-surface-compose': '#fdf9ef',

  // Text — UX-DR2 a11y-darkened values
  '--cl-ink': '#1a1f2e',
  '--cl-ink-soft': '#2c3242',
  '--cl-muted': '#595c66',

  // Accents
  '--cl-accent': '#1e3a8a',
  '--cl-accent-2': '#d97706',
  '--cl-accent-2-text': '#7c4309',
  '--cl-accent-2-btn': '#92500a',

  // Borders
  '--cl-line': '#d9d2c4',
  '--cl-line-soft': '#e6e1d5',
  '--cl-line-interactive': '#a8a095',

  // Status
  '--cl-green': '#166534',
  '--cl-red': '#991b1b',
  '--cl-amber': '#b45309',

  // Status tints
  '--cl-tint-blue': '#eef0fb',
  '--cl-tint-gold': '#fdf6e3',
  '--cl-tint-green': '#ecf4ec',
  '--cl-tint-red': '#fbeaea',

  // Chip
  '--cl-chip-bg': '#ebe5d6',

  // Texture (AC7 — promoted from inline rgba to retire stylelint-disable)
  '--cl-ink-dot': 'rgba(26, 31, 46, 0.04)',

  // Typography
  '--cl-font-display': "'Fraunces', 'Times New Roman', serif",
  '--cl-font-body': "'Geist', system-ui, sans-serif",
  '--cl-font-mono': "'Geist Mono', monospace",

  // Radius
  '--cl-radius-xs': '4px',
  '--cl-radius-sm': '6px',
  '--cl-radius-md': '8px',
  '--cl-radius-lg': '10px',
  '--cl-radius-xl': '12px',
  '--cl-radius-2xl': '14px',
  '--cl-radius-full': '999px',

  // Shadows + scrim
  '--cl-shadow-subtle': '0 1px 3px rgba(0, 0, 0, 0.06)',
  '--cl-shadow-card': '0 8px 24px -12px rgba(26, 31, 46, 0.08)',
  '--cl-shadow-dropdown': '0 6px 20px -6px rgba(26, 31, 46, 0.4)',
  '--cl-shadow-modal': '0 30px 60px -20px rgba(26, 31, 46, 0.5)',
  '--cl-shadow-amber': '0 4px 14px -6px rgba(217, 119, 6, 0.4)',
  '--cl-scrim': 'rgba(26, 31, 46, 0.32)',

  // Sidebar
  '--cl-sidebar-bg': '#1a1f2e',
  '--cl-sidebar-text': '#cfd1d8',
  '--cl-sidebar-hover': '#252a39',
  '--cl-sidebar-active-bg': '#ffffff',
  '--cl-sidebar-active-text': '#1a1f2e',
  '--cl-sidebar-width': '220px',

  // Layout
  '--cl-topbar-height': '56px',
  '--cl-page-max-width': '1320px',
  '--cl-modal-width': '460px',
  '--cl-side-panel': '300px',
  '--cl-detail-panel': '320px',
}

function parseRootDeclarations(css: string): Map<string, string> {
  const rootMatch = css.match(/:root\s*\{([\s\S]*?)\}/)
  if (!rootMatch) {
    throw new Error('tokens.css: no :root block found')
  }
  const body = rootMatch[1]
  const declarations = new Map<string, string>()
  const declRegex = /(--[\w-]+)\s*:\s*([^;]+);/g
  let match: RegExpExecArray | null
  while ((match = declRegex.exec(body)) !== null) {
    declarations.set(match[1], match[2].trim())
  }
  return declarations
}

describe('tokens.css presence and value contract (AC1 + AC7)', () => {
  const tokensCss = readFileSync(TOKENS_PATH, 'utf8')
  const declarations = parseRootDeclarations(tokensCss)

  test.each(Object.entries(EXPECTED_TOKENS))(
    'declares %s with the canonical UX-spec value',
    (token, expectedValue) => {
      const actualValue = declarations.get(token)
      expect(actualValue, `missing token: ${token}`).toBeDefined()
      expect(actualValue).toBe(expectedValue)
    },
  )

  test('does not introduce ad-hoc tokens beyond the canonical set', () => {
    const expectedTokens = new Set(Object.keys(EXPECTED_TOKENS))
    const unexpected: string[] = []
    declarations.forEach((_value, name) => {
      if (!expectedTokens.has(name)) {
        unexpected.push(name)
      }
    })
    expect(unexpected, `unexpected ad-hoc tokens: ${unexpected.join(', ')}`).toEqual([])
  })

  test('declares the --cl-ink-dot Texture token (AC7 stylelint-disable retirement)', () => {
    expect(declarations.get('--cl-ink-dot')).toBe('rgba(26, 31, 46, 0.04)')
  })
})
