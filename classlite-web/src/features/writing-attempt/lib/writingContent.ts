/**
 * writingContent — Story 5.3 Task 1 (AC4/AC6/AC12). This story OWNS the writing
 * `submission.content` JSONB shape (opaque to the backend, ≤256 KiB):
 *
 *   { schemaVersion: 1, text: string }   // plain text, D1 — no HTML / rich text
 *
 * Each save is a FULL replace of `content`; the wire body is exactly
 * `{ schemaVersion: 1, text }` (AC4). Grading (Epic 6) reads `text`; downstream
 * renders must use `white-space: pre-wrap` so paragraph `\n`s survive (Sally N3).
 *
 * All exports are pure so they unit-test directly and back the shared Query-cache
 * draft slice + the localStorage mirror without a React harness.
 */
import type { components } from '@/lib/api/client'
import type { DraftMerge, ReconcileConfig } from '@/features/attempts'

type AttemptExercise = components['schemas']['AttemptExercise']

/** The only content schema version this story emits (D1/AC4). */
export const WRITING_CONTENT_SCHEMA_VERSION = 1 as const

/**
 * The writing-attempt shape of `submission.content`. The generated
 * `SubmissionContent` is an open `{ [k]: unknown }` bag — this is the concrete
 * plain-text shape this feature reads and writes into it.
 */
export interface WritingContent {
  schemaVersion: typeof WRITING_CONTENT_SCHEMA_VERSION
  text: string
}

/** The versioned empty content — a fresh, blank essay draft. */
export function emptyWritingContent(): WritingContent {
  return { schemaVersion: WRITING_CONTENT_SCHEMA_VERSION, text: '' }
}

/**
 * Coerce an untrusted `content` bag (server response or localStorage) into the
 * concrete `WritingContent` shape. A non-string `text`, or a missing / mis-typed
 * container, degrades to empty text; `schemaVersion` is always re-stamped to the
 * version this story emits (a resumed old/missing version normalizes without
 * throwing, AC4).
 */
export function normalizeWritingContent(raw: unknown): WritingContent {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return emptyWritingContent()
  }
  const bag = raw as Record<string, unknown>
  const text = typeof bag.text === 'string' ? bag.text : ''
  return { schemaVersion: WRITING_CONTENT_SCHEMA_VERSION, text }
}

/**
 * The canonical word count (AC6): whitespace-split, trimmed, empties filtered.
 * Whitespace-agnostic across spaces / tabs / CRLF / LF / blank paragraphs; a
 * long single token is one word; Vietnamese diacritic words split on whitespace
 * exactly like ASCII words (each space-delimited run is one word).
 *
 * IME note (AC6, Sally S9): composition safety is the EDITOR LEAF's concern — the
 * leaf gates recompute on `compositionstart`/`compositionend` so telex/VNI
 * diacritic composition isn't counted mid-keystroke. This function is a pure
 * count of a settled string.
 */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed.length === 0) return 0
  return trimmed.split(/\s+/).length
}

/**
 * Client-side minimum-word defaults keyed to IELTS task type (Ducdo ruling
 * 2026-08-05, D3). Ships the "count / min" surface + the under-length warning
 * NOW; the real `exercise.minWords` backend field is FU-5-3-A (deferred-work).
 */
export const WRITING_MIN_WORDS = {
  task1: 150,
  task2: 250,
} as const

/** The documented fallback when no task type can be inferred (IELTS Task 2). */
export const DEFAULT_MIN_WORDS = WRITING_MIN_WORDS.task2

/**
 * Resolve the client-side minimum word count for an exercise (D3). Interim
 * heuristic until FU-5-3-A lands a real `exercise.minWords` field: infer the IELTS
 * task from the exercise title (`Task 1` → 150, `Task 2` → 250), else the
 * documented default (250). Pure + unit-tested so the migration is a one-line swap.
 * @param exercise the attempt exercise (title carries the interim task signal).
 * @returns the minimum word count to display + warn against.
 */
export function minWordsFor(exercise: AttemptExercise): number {
  const title = exercise.title.toLowerCase()
  if (/task\s*1\b/.test(title)) return WRITING_MIN_WORDS.task1
  if (/task\s*2\b/.test(title)) return WRITING_MIN_WORDS.task2
  return DEFAULT_MIN_WORDS
}

/**
 * The writing conflict signal surfaced to the page for its reconcile toast. Unlike
 * quiz (per-answer union), writing is a whole-value document: either the local
 * (student's newer offline/crash) draft was recovered, or a DETECTED foreign
 * change made the server win (AC12/AC13).
 */
export interface WritingReconcileConflict {
  /** True when the local (newer) draft won over a stale server autosave. */
  recoveredLocalNewer: boolean
  /** True when a detected concurrent foreign writer made the server win. */
  serverWonForeign: boolean
}

/** The conflict signal for "no reconcile ran" / no divergence. */
export const WRITING_NO_CONFLICT: WritingReconcileConflict = {
  recoveredLocalNewer: false,
  serverWonForeign: false,
}

/**
 * Build the whole-value writing reconcile merge (AC12, D4 — the party-mode
 * BLOCKER). The default policy is **LOCAL-newer-wins**: the localStorage mirror
 * write-throughs on every debounced edit, so after single-tab offline typing the
 * local copy is strictly newer than the server's stale pre-offline autosave;
 * taking the server here would DELETE the offline paragraphs the "saved locally"
 * indicator promised. Server-wins is reserved for a DETECTED foreign change
 * (`foreignChanged` — a real concurrent writer, surfaced by the AC13
 * BroadcastChannel path), never the default.
 * @param foreignChanged whether a concurrent foreign writer was detected.
 * @returns a `DraftMerge` for the shared reconcile seam.
 */
export function makeWritingMerge(
  foreignChanged: boolean,
): DraftMerge<WritingContent, WritingReconcileConflict> {
  return (local, server) => {
    if (local === null) {
      return { merged: server, conflict: { ...WRITING_NO_CONFLICT } }
    }
    if (foreignChanged) {
      // A real concurrent writer advanced the server underneath us — server wins,
      // and the orphaned local text is warned about separately (AC13), never
      // silently dropped.
      return {
        merged: server,
        conflict: { recoveredLocalNewer: false, serverWonForeign: true },
      }
    }
    if (local.text === server.text) {
      return { merged: server, conflict: { ...WRITING_NO_CONFLICT } }
    }
    // No foreign change + divergent → the LOCAL draft is the student's newer
    // intent (mirror ≥ server in recency). Keep it (last-write-wins-local).
    return {
      merged: local,
      conflict: { recoveredLocalNewer: true, serverWonForeign: false },
    }
  }
}

/** The default (no-foreign-change) reconcile merge — LOCAL-newer-wins (D4). */
export const reconcileWritingDrafts = makeWritingMerge(false)

/**
 * The writing reconcile config wired into `reconcileStoredDraftIntoCache`:
 * normalize the untrusted blob into `WritingContent`, merge via the default
 * local-newer-wins policy, and report `WRITING_NO_CONFLICT` when the slot was
 * already seeded.
 */
export const writingReconcileConfig: ReconcileConfig<
  WritingContent,
  WritingReconcileConflict
> = {
  normalize: normalizeWritingContent,
  merge: reconcileWritingDrafts,
  noConflict: WRITING_NO_CONFLICT,
}
