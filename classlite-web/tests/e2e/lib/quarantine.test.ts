/**
 * Quarantine lane — red-first vitest guards (Story 11-5a, AC7).
 *
 * WHY vitest, not Playwright: per the E2E red-phase convention
 * (docs/bmad-story-conventions.md#E2E-red-phase-convention) the teeth of a
 * harness story are unit tests on the harness logic, never
 * Playwright-on-Playwright. These guards enforce the three quarantine
 * invariants the story ships NOW: shrink-only, assertion-granularity,
 * still-runs. (The 2-cycle-expiry + CI cycle-counter are DEFERRED to 11-6a —
 * see AC7 / Out of Scope — so there is deliberately no expiry guard here.)
 *
 * RED NOW: this file imports `./quarantine`, which does not exist yet →
 * `tsc -b` TS2307 + vitest collection failure (the repo's compile-fail red
 * convention). Creating `tests/e2e/lib/quarantine.ts` (Task 6) turns every
 * assertion below green, and they then stand as permanent regression guards.
 *
 * SHRINK-ONLY uses a REAL git read of the committed baseline
 * (`git show HEAD:…/quarantine.json`) — AC7 (party-mode Murat #6a) requires the
 * guard to compare the working tree against the committed file, not an
 * in-memory fixture. That live-read case skips-with-reason when the file is not
 * yet committed at HEAD (first introduction), the same data-dependent idiom as
 * the credentials-manifest guard; the pure-logic cases always run.
 *
 * ENVIRONMENT NOTE: default jsdom env; uses node:fs/node:child_process only
 * (both resolve under jsdom in vitest — jsdom only swaps DOM globals).
 */
import { describe, expect, it } from 'vitest'
import {
  COMMITTED_BASELINE_PATH,
  QUARANTINE_PATH,
  detectAddedEntries,
  entryKey,
  loadQuarantine,
  readCommittedBaseline,
  runQuarantinable,
  validateQuarantineEntries,
  type QuarantineEntry,
} from './quarantine'

const baseEntry: QuarantineEntry = {
  spec: 'money-path/money-path.spec.ts',
  assertion: 'reading score matches the known answer key',
  owner: 'amelia',
  hypothesis: 'suspected media-launch-flag race on cold chromium',
  budget: '2 cycles',
  enteredCycle: 1,
}

describe('11-5a AC7 — quarantine.json is well-formed and loadable', () => {
  it('ships as a valid (initially empty) assertion-level allowlist', () => {
    const entries = loadQuarantine()
    expect(Array.isArray(entries)).toBe(true)
    // Today's suite has zero quarantined assertions (AC7). Every entry that
    // DOES exist must be assertion-granular (validated on load).
    for (const e of entries) {
      expect(e.spec).toBeTruthy()
      expect(e.assertion).toBeTruthy()
    }
  })

  it('treats an empty / whitespace-only file as an empty allowlist (not a JSON error)', () => {
    // A truncated-to-zero-bytes quarantine.json has the same intent as a missing
    // file — an empty allowlist — and must not hard-fail the loader.
    expect(loadQuarantine('')).toEqual([])
    expect(loadQuarantine('   \n\t ')).toEqual([])
  })
})

describe('11-5a AC7 — assertion granularity (a file-level entry is rejected)', () => {
  it('accepts an entry that names a specific assertion', () => {
    expect(() => validateQuarantineEntries([baseEntry])).not.toThrow()
  })

  it('rejects a file-level entry (no assertion → silence on the spec’s other assertions)', () => {
    // A spec-file-only entry buys silence on every other assertion in that file
    // (epic-11.md:229). The loader must reject it.
    const fileLevel = { ...baseEntry, assertion: '' }
    expect(() => validateQuarantineEntries([fileLevel])).toThrow()
    const missingAssertion = {
      spec: baseEntry.spec,
      owner: baseEntry.owner,
      hypothesis: baseEntry.hypothesis,
      budget: baseEntry.budget,
      enteredCycle: baseEntry.enteredCycle,
    }
    expect(() => validateQuarantineEntries([missingAssertion])).toThrow()
  })

  it('rejects an entry missing required metadata (owner / hypothesis / budget / enteredCycle)', () => {
    const { owner: _owner, ...noOwner } = baseEntry
    expect(() => validateQuarantineEntries([noOwner])).toThrow()
    const { enteredCycle: _cycle, ...noCycle } = baseEntry
    expect(() => validateQuarantineEntries([noCycle])).toThrow()
  })

  it('rejects a non-array payload', () => {
    expect(() => validateQuarantineEntries({} as unknown)).toThrow()
  })

  it('rejects a whitespace-only assertion or spec (blank is not assertion-granular)', () => {
    // A `" "` assertion is non-empty by length but can never match a real
    // assertion id — a silent dead entry that defeats the granularity invariant.
    expect(() => validateQuarantineEntries([{ ...baseEntry, assertion: '   ' }])).toThrow()
    expect(() => validateQuarantineEntries([{ ...baseEntry, spec: '  \t' }])).toThrow()
  })
})

describe('11-5a AC7 — shrink-only (an entry ADDED beyond the baseline fails)', () => {
  it('detects an addition (baseline empty → working has one entry)', () => {
    expect(detectAddedEntries([], [baseEntry])).toEqual([entryKey(baseEntry)])
  })

  it('permits a removal (baseline has one entry → working empty)', () => {
    expect(detectAddedEntries([baseEntry], [])).toEqual([])
  })

  it('permits an unchanged list', () => {
    expect(detectAddedEntries([baseEntry], [baseEntry])).toEqual([])
  })

  it('flags only the NET-NEW key when some overlap', () => {
    const other: QuarantineEntry = { ...baseEntry, assertion: 'listening score matches key' }
    expect(detectAddedEntries([baseEntry], [baseEntry, other])).toEqual([entryKey(other)])
  })

  it('does not collide two entries that differ only by where "::" falls (collision-safe key)', () => {
    // With the old `spec::assertion` concatenation these two keyed identically to
    // `a::b::c` — one would silently mask the other (shrink-only false-pass).
    const splitLeft: QuarantineEntry = { ...baseEntry, spec: 'a', assertion: 'b::c' }
    const splitRight: QuarantineEntry = { ...baseEntry, spec: 'a::b', assertion: 'c' }
    expect(entryKey(splitLeft)).not.toBe(entryKey(splitRight))
    // Adding splitRight on top of a baseline holding splitLeft is a real addition
    // and must be flagged — not swallowed by a key collision.
    expect(detectAddedEntries([splitLeft], [splitLeft, splitRight])).toEqual([entryKey(splitRight)])
  })

  it('(live git read) the working quarantine.json adds no entry beyond the committed baseline', (ctx) => {
    // AC7 (Murat #6a): this is an EXPLICIT git read of the committed file, not a
    // pure in-memory fixture. Skip-with-reason only while the file is not yet
    // committed at HEAD (first introduction) — identical data-dependent idiom to
    // the credentials-manifest guard. A REAL skip (visible in the report), never
    // a bare `return` that would record a misleading pass. (A genuine git fault,
    // vs first-landing, now throws inside readCommittedBaseline — it does NOT
    // reach here as a null, so the guard can never be silently skipped.)
    const baseline = readCommittedBaseline()
    if (baseline === null) {
      ctx.skip()
      return
    }
    const working = loadQuarantine()
    expect(
      detectAddedEntries(baseline, working),
      `quarantine.json must be shrink-only vs the committed baseline ` +
        `(${COMMITTED_BASELINE_PATH}); remove added entries or justify in a new cycle`,
    ).toEqual([])
  })

  it('exposes the quarantine file path for tooling', () => {
    expect(QUARANTINE_PATH).toMatch(/quarantine\.json$/)
  })
})

describe('11-5a AC7 — still-runs (a quarantined assertion executes + reports, non-gating)', () => {
  const entries = [baseEntry]

  it('executes a quarantined failing assertion, reports it, and does NOT throw (non-gating)', async () => {
    let ran = false
    const reported: string[] = []
    const result = await runQuarantinable({
      entries,
      spec: baseEntry.spec,
      assertion: baseEntry.assertion,
      run: () => {
        ran = true
        throw new Error('flaky failure under quarantine')
      },
      report: (line) => reported.push(line),
    })
    expect(ran, 'the quarantined assertion must still RUN').toBe(true)
    expect(reported.length, 'the failure must be REPORTED (non-silent)').toBeGreaterThan(0)
    expect(result.quarantined).toBe(true)
    expect(result.passed).toBe(false)
  })

  it('executes a quarantined PASSING assertion and reports a pass', async () => {
    let ran = false
    const reported: string[] = []
    const result = await runQuarantinable({
      entries,
      spec: baseEntry.spec,
      assertion: baseEntry.assertion,
      run: () => {
        ran = true
      },
      report: (line) => reported.push(line),
    })
    expect(ran).toBe(true)
    expect(result.quarantined).toBe(true)
    expect(result.passed).toBe(true)
    expect(reported.length).toBeGreaterThan(0)
  })

  it('RETHROWS a NON-quarantined failing assertion (gating)', async () => {
    await expect(
      runQuarantinable({
        entries,
        spec: baseEntry.spec,
        assertion: 'some OTHER assertion not on the allowlist',
        run: () => {
          throw new Error('real regression — must gate')
        },
        report: () => {},
      }),
    ).rejects.toThrow('real regression')
  })
})
