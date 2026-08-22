/**
 * speakingGradingDraft — Story 6.3a (AC6/AC7 · D8). The DISCRIMINATED speaking draft
 * variant. The writing DraftComment.criterion is typed `keyof CriterionScores` (writing
 * keys) and a speaking criterion isn't assignable; adding timestampMs alone doesn't fix
 * it — so the speaking draft is its OWN variant (speaking criterion union + timestampMs
 * instead of anchorStart/anchorEnd), persisted per-submission in localStorage under a
 * DISTINCT prefix (a mixed-skill queue never clobbers across skills). Mirrors
 * gradingDraft.ts.
 */
import { useCallback, useState } from 'react'

import type { SpeakingCriterionScores, SpeakingCriterionKey } from './speakingOverallBand'

export type SpeakingDraftCommentType = 'error' | 'praise' | 'suggestion'

/** Provenance (mirrors writing FD2). CLIENT-ONLY — buildSpeakingGradeInput strips it
 * along with `id`; the wire TimestampedComment is unchanged. `'ai'` is reserved for
 * 6-3c (accepted AI moments); 6-3a authors only `'teacher'`. */
export type SpeakingDraftCommentSource = 'teacher' | 'ai'

/** A working speaking comment. timestampMs null ⇒ general (unpinned). */
export interface SpeakingDraftComment {
  /** Client-only id for list keying + pin↔card wiring (never sent). */
  id: string
  type: SpeakingDraftCommentType
  criterion: SpeakingCriterionKey
  timestampMs: number | null
  text: string
  /** Client-only provenance (never sent). */
  source: SpeakingDraftCommentSource
}

/** The open, in-progress comment composer (persisted so a half-written note survives
 * refresh + queue nav). timestampMs null ⇒ a general note. null when no composer open.
 * editingId set ⇒ the composer is editing that existing comment (AC6), not adding one. */
export interface SpeakingDraftComposer {
  timestampMs: number | null
  type: SpeakingDraftCommentType
  criterion: SpeakingCriterionKey
  text: string
  editingId?: string | null
}

/** The persisted working speaking grade. scores is partial until all four are set. */
export interface SpeakingGradingDraft {
  scores: Partial<SpeakingCriterionScores>
  comments: SpeakingDraftComment[]
  composer: SpeakingDraftComposer | null
}

// A DISTINCT prefix from the writing draft (`classlite:grading-draft:`) so a mixed-skill
// queue never clobbers across skills (D8).
const KEY_PREFIX = 'classlite:speaking-grading-draft:'

function storageKey(submissionId: string): string {
  return `${KEY_PREFIX}${submissionId}`
}

/** A fresh empty draft. */
export function emptySpeakingGradingDraft(): SpeakingGradingDraft {
  return { scores: {}, comments: [], composer: null }
}

/** Read the persisted draft, or null (absent / corrupt / storage disabled). */
export function readSpeakingGradingDraft(submissionId: string): SpeakingGradingDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(submissionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const draft = parsed as SpeakingGradingDraft
    if (typeof draft.scores !== 'object' || !Array.isArray(draft.comments)) return null
    return draft
  } catch {
    return null
  }
}

/** Write the draft; swallows quota/disabled errors (never throws into render). */
export function writeSpeakingGradingDraft(submissionId: string, draft: SpeakingGradingDraft): void {
  try {
    window.localStorage.setItem(storageKey(submissionId), JSON.stringify(draft))
  } catch {
    // storage full / disabled — the in-memory state is still authoritative this session.
  }
}

/** Drop the draft (post-release). */
export function clearSpeakingGradingDraft(submissionId: string): void {
  try {
    window.localStorage.removeItem(storageKey(submissionId))
  } catch {
    // ignore
  }
}

export interface UseSpeakingGradingDraftResult {
  draft: SpeakingGradingDraft
  setDraft: (updater: (prev: SpeakingGradingDraft) => SpeakingGradingDraft) => void
  clear: () => void
}

/**
 * useSpeakingGradingDraft — the working grade for one speaking submission, seeded from
 * localStorage and written through on every change (no useEffect — the mirror happens in
 * the setter, FW-4). Mount with key={submissionId} so a queue nav re-seeds the draft.
 */
export function useSpeakingGradingDraft(
  submissionId: string,
  seed?: () => SpeakingGradingDraft,
): UseSpeakingGradingDraftResult {
  const [draft, setDraftState] = useState<SpeakingGradingDraft>(() => {
    const stored = readSpeakingGradingDraft(submissionId)
    if (stored) return stored
    return seed ? seed() : emptySpeakingGradingDraft()
  })

  const setDraft = useCallback(
    (updater: (prev: SpeakingGradingDraft) => SpeakingGradingDraft) => {
      setDraftState((prev) => {
        const next = updater(prev)
        writeSpeakingGradingDraft(submissionId, next)
        return next
      })
    },
    [submissionId],
  )

  const clear = useCallback(() => {
    clearSpeakingGradingDraft(submissionId)
    setDraftState(seed ? seed() : emptySpeakingGradingDraft())
  }, [submissionId, seed])

  return { draft, setDraft, clear }
}
