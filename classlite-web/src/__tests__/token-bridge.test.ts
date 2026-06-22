/**
 * Token bridge presence + equivalence test (Story 1d-3 code-review D7).
 *
 * Background: `src/index.css`'s first `:root {...}` block carries the
 * single-point-of-failure bridge from shadcn-semantic names (`--background`,
 * `--card`, `--sidebar-*`, etc.) to the `--cl-*` raw brand tokens defined
 * in `tokens.css`. Winston flagged this at party-mode 2026-06-18: a quiet
 * direct edit (`--background: #fff`) silently desyncs the brand layer —
 * shadcn keeps reading `--sidebar`, Tailwind keeps reading `--color-sidebar`,
 * but the raw `--cl-*` token no longer matches.
 *
 * The CSS file ships a governance comment block (`Use tokens.css
 * exclusively`), but a comment is not enforcement. This test asserts:
 *
 *   1. Every bridge variable the rest of the codebase depends on EXISTS in
 *      the `:root` block. A missing variable means shadcn primitives fall
 *      back to their default-token defaults, silently desynced.
 *   2. Every bridge value is exactly `var(--cl-*)` — a literal color
 *      (`#fff`, `hsl(...)`, `oklch(...)`, `rgb(...)`) means someone bypassed
 *      `tokens.css` and the brand layer is broken for that key.
 *
 * If you intentionally need a literal value for a NEW key, add it to the
 * exception list below. The presence list (`REQUIRED_BRIDGE_KEYS`) is the
 * load-bearing contract — review additions on PR.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, test } from 'vitest'

// Vitest runs with `cwd` set to the package root (`classlite-web/`) so a
// cwd-relative anchor reliably resolves the CSS file across both local
// runs and CI. The earlier `fileURLToPath(import.meta.url)` form failed
// because vitest serves source modules via a virtual URL scheme rather
// than `file://`, so the URL-to-path conversion throws.
const indexCssPath = resolve(process.cwd(), 'src/index.css')

/**
 * Bridge variables consumed by shadcn primitives, Tailwind v4 `@theme`
 * mappings, and 1d-3 domain components. The list mirrors the keys
 * declared in the first `:root {...}` block of `src/index.css`. Adding
 * a new shadcn primitive that relies on a new bridge variable MUST come
 * with an addition here AND in the source CSS.
 */
const REQUIRED_BRIDGE_KEYS = [
  '--background',
  '--foreground',
  '--card',
  '--card-foreground',
  '--popover',
  '--popover-foreground',
  '--primary',
  '--primary-foreground',
  '--secondary',
  '--secondary-foreground',
  '--muted',
  '--muted-foreground',
  '--accent',
  '--accent-foreground',
  '--destructive',
  '--destructive-foreground',
  '--border',
  '--input',
  '--ring',
  '--chart-1',
  '--chart-2',
  '--chart-3',
  '--chart-4',
  '--chart-5',
  '--sidebar',
  '--sidebar-foreground',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-accent',
  '--sidebar-accent-foreground',
  '--sidebar-border',
  '--sidebar-ring',
] as const

/**
 * Pull the first `:root {...}` block out of `index.css` and parse the
 * `--name: value;` declarations into a Map. Strips block comments first
 * so a comment inside the block doesn't confuse the line splitter.
 */
function parseRootBlock(): Map<string, string> {
  const raw = readFileSync(indexCssPath, 'utf8')
  // Strip /* ... */ comments. Greedy across lines.
  const noComments = raw.replace(/\/\*[\s\S]*?\*\//g, '')
  const match = noComments.match(/:root\s*\{([\s\S]*?)\}/)
  if (!match) {
    throw new Error(
      `parseRootBlock: no :root {...} block found in ${indexCssPath}`,
    )
  }
  const body = match[1]
  const declarations = new Map<string, string>()
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const declMatch = trimmed.match(/^(--[a-z0-9-]+)\s*:\s*([^;]+?);?\s*$/i)
    if (!declMatch) continue
    declarations.set(declMatch[1], declMatch[2].trim())
  }
  return declarations
}

describe('token bridge governance (src/index.css)', () => {
  const declarations = parseRootBlock()

  test('every required bridge variable is declared in :root', () => {
    const declared = new Set(declarations.keys())
    const missing = REQUIRED_BRIDGE_KEYS.filter((key) => !declared.has(key))
    expect(missing, `missing bridge vars: ${missing.join(', ')}`).toEqual([])
  })

  test.each(REQUIRED_BRIDGE_KEYS)(
    'bridge variable %s maps to a var(--cl-*) raw token',
    (key) => {
      const value = declarations.get(key)
      expect(value, `bridge var ${key} is undefined`).toBeDefined()
      // Allowed: `var(--cl-foo)` (exact form, no fallback). Anything else
      // (literal color, var() reference to another non-cl variable,
      // `var(--cl-foo, #fff)` fallback) is a brand-layer leak.
      expect(
        value,
        `bridge var ${key} should be exactly var(--cl-*), got: ${value}`,
      ).toMatch(/^var\(--cl-[a-z0-9-]+\)$/)
    },
  )
})
