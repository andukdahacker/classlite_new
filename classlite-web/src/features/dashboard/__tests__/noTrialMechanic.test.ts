/**
 * Story 2-4 — AC10 no-trial mechanic audit red-phase test.
 *
 * Covers Task 7.3 per AC10 (Epic AC6 free-tier positioning invariant):
 *   - Scan scope: `src/features/dashboard/**\/*.{ts,tsx}` (excluding
 *     `__tests__/`) AND `src/locales/{en,vi}.json` [M-STRONG-13 fold]
 *   - Reject-list closed literal [M-STRONG-9 fold]:
 *     `trial`, `Pro trial`, `startPro`, `upgradeToPro`, `sevenDayTrial`,
 *     `freeTrial`, `dùng thử`, `bản dùng thử` (case-insensitive)
 *   - Whitelist [A-STRONG-5 fold]: a match is IGNORED if the same line
 *     contains the marker `NO_TRIAL_MECHANIC_V1` (self-documenting comment)
 *   - Test file itself excluded from scan
 *
 * ATDD contract: this test PASSES vacuously in red-phase (the target
 * directory doesn't exist yet or contains no scanned files). It becomes a
 * real gate once Task 3+/4+/5+/6+ land the actual components. Load-bearing
 * invariant across Epic 9 pickup — a stray `<TrialCta>` component or
 * translator-inserted "dùng thử 7 ngày" copy will red the CI ratchet.
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'

const REJECT_LIST_SUBSTRINGS = [
  'trial',
  'pro trial',
  'startpro',
  'upgradetopro',
  'sevendaytrial',
  'freetrial',
  'dùng thử',
  'bản dùng thử',
] as const

const WHITELIST_MARKER = 'NO_TRIAL_MECHANIC_V1'

// Test file is at `classlite-web/src/features/dashboard/__tests__/`; four
// `..` walk back to `classlite-web/` (the frontend project root — where
// `src/`, `src/locales/`, and `package.json` live).
const CLASSLITE_WEB_ROOT = join(__dirname, '..', '..', '..', '..')
const DASHBOARD_DIR = join(CLASSLITE_WEB_ROOT, 'src', 'features', 'dashboard')
const LOCALES_DIR = join(CLASSLITE_WEB_ROOT, 'src', 'locales')

async function walk(dir: string, matches: (rel: string) => boolean): Promise<string[]> {
  const out: string[] = []
  async function inner(current: string) {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch {
      return // scan-target may not exist during red-phase
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        if (entry.name === '__tests__') continue
        if (entry.name === 'node_modules') continue
        if (entry.name === '.storybook') continue
        await inner(full)
      } else if (entry.isFile()) {
        if (matches(entry.name)) out.push(full)
      }
    }
  }
  await inner(dir)
  return out
}

async function findViolations(file: string): Promise<Array<{ line: number; text: string; substring: string }>> {
  const content = await readFile(file, 'utf8')
  const lines = content.split('\n')
  const violations: Array<{ line: number; text: string; substring: string }> = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? ''
    const lower = line.toLowerCase()
    if (lower.includes(WHITELIST_MARKER.toLowerCase())) continue
    for (const substring of REJECT_LIST_SUBSTRINGS) {
      if (lower.includes(substring)) {
        // Word-boundary check for `trial` — must also catch `trials`
        // (plural) or `startTrials` slips through the previous
        // `\btrial\b` guard (`s` is a word char so `trial` has no
        // trailing boundary in `trials`). Allow `trial-and-error` and
        // `trials-and-...` as legitimate English idioms.
        if (substring === 'trial') {
          const wordBoundary = /\btrials?(?!-and)\b/i
          if (!wordBoundary.test(line)) continue
        }
        violations.push({ line: i + 1, text: line, substring })
      }
    }
  }
  return violations
}

describe('AC10 no-trial-mechanic audit — Epic AC6 free-tier positioning invariant', () => {
  test('src/features/dashboard/**/*.{ts,tsx} contains no trial-mechanic strings (excl __tests__/)', async () => {
    const files = await walk(DASHBOARD_DIR, (name) =>
      name.endsWith('.ts') || name.endsWith('.tsx'),
    )
    // Post-green: the dashboard tree MUST exist. A rename or accidental
    // deletion that hides the directory would silently disarm this audit
    // without an explicit floor check.
    expect(
      files.length,
      `Dashboard scan target (${DASHBOARD_DIR}) resolved to zero files — did the tree move?`,
    ).toBeGreaterThan(0)
    for (const file of files) {
      const violations = await findViolations(file)
      expect(
        violations,
        `${file} contains rejected substrings:\n${violations
          .map((v) => `  line ${v.line}: "${v.text.trim()}" matched "${v.substring}"`)
          .join('\n')}`,
      ).toEqual([])
    }
  })

  test('src/locales/en.json contains no trial-mechanic strings', async () => {
    const enJson = join(LOCALES_DIR, 'en.json')
    // Locale files must exist — silent skip on stat failure would disarm
    // the "dùng thử 7 ngày" translator-copy leak guard.
    await stat(enJson)
    const violations = await findViolations(enJson)
    expect(
      violations.map((v) => `line ${v.line}: ${v.text.trim()}`),
    ).toEqual([])
  })

  test('src/locales/vi.json contains no trial-mechanic strings (Vietnamese "dùng thử" gate)', async () => {
    const viJson = join(LOCALES_DIR, 'vi.json')
    await stat(viJson)
    const violations = await findViolations(viJson)
    expect(
      violations.map((v) => `line ${v.line}: ${v.text.trim()}`),
    ).toEqual([])
  })

  test('reject-list is a closed literal (no dynamic mutation risk)', () => {
    // Meta-test: guards against silent contract erosion
    expect(REJECT_LIST_SUBSTRINGS).toHaveLength(8)
    expect(REJECT_LIST_SUBSTRINGS).toContain('trial')
    expect(REJECT_LIST_SUBSTRINGS).toContain('dùng thử')
  })
})
