/**
 * Quarantine lane (Story 11-5a, AC7) — the mechanism that keeps the real-stack
 * E2E suite honest instead of decaying into `test.describe.skip()` the way the
 * pre-11-5a tree did (`13 failed / 21 skipped / 44 passed`, 2026-09-27).
 *
 * A quarantined assertion STILL RUNS and STILL REPORTS — it is simply
 * non-gating: a failure is surfaced (never silent) but does not fail the build.
 * That is the whole point of quarantine over `skip`: a skipped assertion stops
 * telling you anything, a quarantined one keeps telling you — it just stops
 * blocking the lane while its owner investigates within a stated budget.
 *
 * THREE INVARIANTS SHIPPED NOW (guarded red-first in `quarantine.test.ts`):
 *   1. Assertion granularity — an entry names ONE assertion inside a spec, never
 *      a whole spec file (a file-level entry would buy silence on all its other
 *      assertions, epic-11.md:229). `validateQuarantineEntries` rejects a
 *      file-level / assertion-less entry.
 *   2. Shrink-only per cycle — the working `quarantine.json` may only REMOVE
 *      entries vs the committed baseline (`git show HEAD:…`), never add
 *      (`detectAddedEntries`). Adding an entry is a deliberate act that belongs
 *      to a new cycle, not a silent slide.
 *   3. Still-runs + reports — `runQuarantinable` executes the assertion, reports
 *      the outcome via an injected reporter, and swallows a failure ONLY when the
 *      assertion is on the allowlist; a non-quarantined failure rethrows (gates).
 *
 * DEFERRED to 11-6a (AC7 / Out of Scope — party-mode trim): the 2-cycle-expiry
 * enforcement and the CI-bumped cycle counter. There is no loop cadence/identity
 * yet, so enforcing expiry now would be an inert false-green (the counter would
 * never increment). The `enteredCycle` field below is captured NOW as metadata
 * so 11-6a has the data; nothing here enforces it.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const moduleDir = dirname(fileURLToPath(import.meta.url))

/** QUARANTINE_PATH is the working-copy allowlist, resolved from this module. */
export const QUARANTINE_PATH = resolve(moduleDir, '../quarantine.json')

/**
 * COMMITTED_BASELINE_PATH is the repo-root-relative path `git show HEAD:<path>`
 * reads the committed baseline from (shrink-only comparison). It is relative to
 * the git root, NOT this module, because that is the syntax `git show HEAD:`
 * requires.
 */
export const COMMITTED_BASELINE_PATH = 'classlite-web/tests/e2e/quarantine.json'

/**
 * QuarantineEntry is one non-gating assertion allowance. `spec` + `assertion`
 * together identify exactly one assertion (granularity); the remaining fields
 * are the accountability metadata every entry must carry.
 */
export interface QuarantineEntry {
  /** The spec file the assertion lives in, relative to `tests/e2e/` (e.g. `money-path/money-path.spec.ts`). */
  spec: string
  /** The specific assertion id within the spec — REQUIRED, non-empty (granularity). */
  assertion: string
  /** Who owns driving this entry back to green. */
  owner: string
  /** The current working theory for the flake/failure. */
  hypothesis: string
  /** The stated budget before it must be fixed or explicitly re-justified (free-form, e.g. `2 cycles`). */
  budget: string
  /** The cycle this entry was added (metadata for the 11-6a expiry enforcement; NOT enforced here). */
  enteredCycle: number
}

/**
 * entryKey is the stable identity of an entry. It is a JSON-encoded `[spec,
 * assertion]` tuple rather than a `spec::assertion` concatenation so a `spec` or
 * `assertion` value that itself contains the old `::` separator cannot collide
 * two distinct entries into one key (which would let `detectAddedEntries` miss a
 * net-new addition — a shrink-only false-pass — or make `isQuarantined` match the
 * wrong assertion).
 */
export function entryKey(entry: Pick<QuarantineEntry, 'spec' | 'assertion'>): string {
  return JSON.stringify([entry.spec, entry.assertion])
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

/**
 * isNonBlankString is `isNonEmptyString` plus a trim: a whitespace-only value is
 * rejected. Used for the identity fields (`spec`, `assertion`) so a `" "`
 * assertion cannot slip past the granularity invariant as a non-empty-but-
 * meaningless entry that can never match a real assertion id.
 */
function isNonBlankString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * validateQuarantineEntries parses + validates a raw payload into typed entries,
 * throwing (never silently dropping) on any violation: a non-array, a missing
 * required field, or — the granularity invariant — a file-level entry whose
 * `assertion` is absent or empty.
 *
 * @param data the parsed JSON payload (unknown shape).
 * @returns the validated entries.
 */
export function validateQuarantineEntries(data: unknown): QuarantineEntry[] {
  if (!Array.isArray(data)) {
    throw new Error('quarantine.json must be a JSON array of entries')
  }
  return data.map((raw, index) => {
    const at = `quarantine.json[${index}]`
    if (typeof raw !== 'object' || raw === null) {
      throw new Error(`${at}: each entry must be an object`)
    }
    const entry = raw as Record<string, unknown>
    if (!isNonBlankString(entry.spec)) {
      throw new Error(`${at}: "spec" is required`)
    }
    // Granularity: a spec-file-only entry is rejected — it would silence every
    // other assertion in the file. "assertion" MUST be present and non-blank (a
    // whitespace-only value can never match a real assertion id, so it is just a
    // silent dead entry that defeats the invariant).
    if (!isNonBlankString(entry.assertion)) {
      throw new Error(
        `${at}: "assertion" is required and non-empty — quarantine is at ASSERTION ` +
          `granularity, a file-level entry is forbidden (it would silence the spec’s other assertions)`,
      )
    }
    if (!isNonEmptyString(entry.owner)) {
      throw new Error(`${at}: "owner" is required`)
    }
    if (!isNonEmptyString(entry.hypothesis)) {
      throw new Error(`${at}: "hypothesis" is required`)
    }
    if (!isNonEmptyString(entry.budget)) {
      throw new Error(`${at}: "budget" is required`)
    }
    if (typeof entry.enteredCycle !== 'number' || !Number.isFinite(entry.enteredCycle)) {
      throw new Error(`${at}: "enteredCycle" is required and must be a number`)
    }
    return {
      spec: entry.spec,
      assertion: entry.assertion,
      owner: entry.owner,
      hypothesis: entry.hypothesis,
      budget: entry.budget,
      enteredCycle: entry.enteredCycle,
    }
  })
}

/**
 * loadQuarantine reads + validates the working-copy allowlist. A missing file is
 * treated as an empty allowlist (the mechanism can exist before anything is
 * quarantined); a present-but-malformed file throws (never a silent empty set).
 *
 * @param raw optional raw JSON string (for testing); defaults to reading QUARANTINE_PATH.
 * @returns the validated entries.
 */
export function loadQuarantine(raw?: string): QuarantineEntry[] {
  let text = raw
  if (text === undefined) {
    if (!existsSync(QUARANTINE_PATH)) return []
    text = readFileSync(QUARANTINE_PATH, 'utf8')
  }
  // An empty / whitespace-only file is an empty allowlist — the same intent as a
  // missing file — not a JSON error (a truncated-to-zero-bytes file must not hard
  // fail the loader).
  if (text.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (cause) {
    throw new Error(`quarantine.json is not valid JSON`, { cause })
  }
  return validateQuarantineEntries(parsed)
}

/**
 * isPathAbsentAtHead reports whether a `git show HEAD:<path>` failure is the
 * benign "the path is not in the HEAD tree yet" case (a genuine first landing)
 * rather than a real git fault. git exits 128 with a stable message for an
 * otherwise-valid pathspec that is absent from HEAD ("exists on disk, but not in
 * 'HEAD'" / "does not exist in 'HEAD'"). Anything else — git binary missing
 * (ENOENT), not a repository, detached/corrupt HEAD, maxBuffer exceeded — must
 * NOT be treated as a first landing.
 */
function isPathAbsentAtHead(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false
  const stderrRaw = (error as { stderr?: unknown }).stderr
  const stderr =
    typeof stderrRaw === 'string'
      ? stderrRaw
      : Buffer.isBuffer(stderrRaw)
        ? stderrRaw.toString('utf8')
        : ''
  return /exists on disk, but not in/.test(stderr) || /does not exist in/.test(stderr)
}

/**
 * parseCommittedBaseline turns the raw `git show` output into entries. A
 * committed-but-empty/whitespace file is an empty allowlist (same intent as the
 * working-copy empty case); a malformed committed file throws a clear error
 * (mirroring `loadQuarantine`) rather than a raw SyntaxError.
 */
function parseCommittedBaseline(out: string): QuarantineEntry[] {
  if (out.trim() === '') return []
  let parsed: unknown
  try {
    parsed = JSON.parse(out)
  } catch (cause) {
    throw new Error(
      `the committed quarantine baseline (${COMMITTED_BASELINE_PATH}) is not valid JSON`,
      { cause },
    )
  }
  return validateQuarantineEntries(parsed)
}

/**
 * readCommittedBaseline returns the entries committed at HEAD via a REAL
 * `git show HEAD:<path>` (AC7 — the shrink-only guard reads git, not an
 * in-memory fixture). Returns `null` ONLY when the path is genuinely not yet in
 * the HEAD tree (first introduction) so the caller can skip-with-reason. ANY
 * OTHER git failure throws — returning null there would silently disable the
 * shrink-only guard (a green pass that verified nothing), the exact decay this
 * lane exists to prevent.
 *
 * @returns the committed entries, or `null` if the file is not committed at HEAD.
 */
export function readCommittedBaseline(): QuarantineEntry[] | null {
  let out: string
  try {
    out = execFileSync('git', ['show', `HEAD:${COMMITTED_BASELINE_PATH}`], {
      encoding: 'utf8',
    })
  } catch (error) {
    if (isPathAbsentAtHead(error)) return null
    throw new Error(
      `shrink-only guard could not read the committed baseline via ` +
        `\`git show HEAD:${COMMITTED_BASELINE_PATH}\` — this is NOT a first landing, ` +
        `so the guard must fail loud rather than be silently skipped`,
      { cause: error },
    )
  }
  return parseCommittedBaseline(out)
}

/**
 * detectAddedEntries returns the keys present in `working` but absent from
 * `baseline` — i.e. the shrink-only violations. Removals and unchanged entries
 * yield an empty result.
 *
 * @param baseline the committed baseline entries.
 * @param working the working-copy entries.
 * @returns the net-new keys (empty when shrink-only holds).
 */
export function detectAddedEntries(
  baseline: QuarantineEntry[],
  working: QuarantineEntry[],
): string[] {
  const baselineKeys = new Set(baseline.map(entryKey))
  return working.map(entryKey).filter((key) => !baselineKeys.has(key))
}

/** isQuarantined reports whether a given (spec, assertion) is on the allowlist. */
export function isQuarantined(
  entries: QuarantineEntry[],
  spec: string,
  assertion: string,
): boolean {
  const key = entryKey({ spec, assertion })
  return entries.some((e) => entryKey(e) === key)
}

/** QuarantineOutcome is what `runQuarantinable` reports back to the caller. */
export interface QuarantineOutcome {
  /** Whether the assertion was on the allowlist (and therefore non-gating on failure). */
  quarantined: boolean
  /** Whether the assertion passed. */
  passed: boolean
  /** The error, when the assertion failed. */
  error?: unknown
}

/** RunQuarantinableOptions configures one still-runs quarantine execution. */
export interface RunQuarantinableOptions<T> {
  /** The loaded allowlist. */
  entries: QuarantineEntry[]
  /** The spec file the assertion lives in. */
  spec: string
  /** The assertion id. */
  assertion: string
  /** The assertion body (may be async). */
  run: () => T | Promise<T>
  /** Reporter for the outcome — a quarantined outcome is REPORTED, never silent. */
  report: (line: string) => void
}

/**
 * runQuarantinable executes an assertion and applies the quarantine contract:
 * the assertion ALWAYS runs (still-runs); its outcome is ALWAYS reported; a
 * FAILURE is swallowed (non-gating) ONLY when the assertion is on the allowlist,
 * otherwise it rethrows (gating). This is the single integration seam specs use
 * to wrap a known-flaky assertion — there is zero quarantined today, so in
 * practice everything is gating until an entry lands in `quarantine.json`.
 *
 * @param options the run configuration.
 * @returns the outcome (quarantined / passed / error).
 */
export async function runQuarantinable<T>(
  options: RunQuarantinableOptions<T>,
): Promise<QuarantineOutcome> {
  const { entries, spec, assertion, run, report } = options
  const quarantined = isQuarantined(entries, spec, assertion)
  const key = entryKey({ spec, assertion })
  try {
    await run()
    report(`[quarantine] PASS ${key}${quarantined ? ' (quarantined, non-gating)' : ''}`)
    return { quarantined, passed: true }
  } catch (error) {
    if (quarantined) {
      // Still reported, never silent — but non-gating.
      report(`[quarantine] FAIL (non-gating) ${key}: ${String(error)}`)
      return { quarantined: true, passed: false, error }
    }
    // Not quarantined → a real regression gates the lane.
    throw error
  }
}
