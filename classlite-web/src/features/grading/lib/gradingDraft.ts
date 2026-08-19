/**
 * gradingDraft — Story 6.1 (D4/AC15). The in-progress grade (criterion scores +
 * comment list) persisted client-side PER SUBMISSION in localStorage, surviving
 * refresh AND queue navigation. A draft is PRIVATE (never student-visible) until the
 * teacher explicitly Submits/Releases; navigating "Next student" auto-persists the
 * draft but NEVER publishes. Mirrors the attempts-spine localStorage mirror.
 */
import { useCallback, useState } from 'react'
import type { CriterionScores } from './computeOverallBand'

export type DraftCommentType = 'error' | 'praise' | 'suggestion'

/** A working comment in the draft. criterion is REQUIRED (one of the four IELTS
 * keys) — the composer no longer offers a null "General" option (chunk-2 review
 * Decision A: the server criterion enum is non-null, so a null was silently
 * collapsed to taskResponse). */
export interface DraftComment {
  /** Client-only id for list keying + pin↔card wiring (never sent). */
  id: string
  type: DraftCommentType
  criterion: keyof CriterionScores
  anchorStart: number | null
  anchorEnd: number | null
  text: string
}

/**
 * DraftComposer is the open, in-progress comment (anchor + type + criterion + body)
 * persisted alongside the grade so a half-written comment survives refresh AND queue
 * navigation (AC15/AC16 — chunk-2 review Decision B). rectTop/rectLeft are the last
 * popover position (best-effort restore). null when no composer is open.
 */
export interface DraftComposer {
  anchorStart: number
  anchorEnd: number
  rectTop: number
  rectLeft: number
  type: DraftCommentType
  criterion: keyof CriterionScores
  text: string
}

/** The persisted working grade. scores is partial until all four are set. */
export interface GradingDraft {
  scores: Partial<CriterionScores>
  comments: DraftComment[]
  composer: DraftComposer | null
}

const KEY_PREFIX = 'classlite:grading-draft:'

function storageKey(submissionId: string): string {
  return `${KEY_PREFIX}${submissionId}`
}

/** A fresh empty draft. */
export function emptyGradingDraft(): GradingDraft {
  return { scores: {}, comments: [], composer: null }
}

/** Read the persisted draft, or null (absent / corrupt / storage disabled). */
export function readGradingDraft(submissionId: string): GradingDraft | null {
  try {
    const raw = window.localStorage.getItem(storageKey(submissionId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as unknown
    if (typeof parsed !== 'object' || parsed === null) return null
    const draft = parsed as GradingDraft
    if (typeof draft.scores !== 'object' || !Array.isArray(draft.comments)) return null
    return draft
  } catch {
    return null
  }
}

/** Write the draft; swallows quota/disabled errors (never throws into render). */
export function writeGradingDraft(submissionId: string, draft: GradingDraft): void {
  try {
    window.localStorage.setItem(storageKey(submissionId), JSON.stringify(draft))
  } catch {
    // storage full / disabled — the in-memory state is still authoritative this session.
  }
}

/** Drop the draft (post-release). */
export function clearGradingDraft(submissionId: string): void {
  try {
    window.localStorage.removeItem(storageKey(submissionId))
  } catch {
    // ignore
  }
}

export interface UseGradingDraftResult {
  draft: GradingDraft
  /** Replace the draft (write-through to localStorage). */
  setDraft: (updater: (prev: GradingDraft) => GradingDraft) => void
  /** Drop the persisted + in-memory draft (post-release). */
  clear: () => void
}

/**
 * useGradingDraft — the working grade for one submission, seeded from localStorage
 * and written through on every change (no useEffect — the mirror happens in the
 * setter, FW-4). Mount the editor with key={submissionId} so a queue nav re-seeds
 * the draft for the new submission (lossless prev/next round-trip).
 *
 * @param submissionId the submission being graded.
 * @param seed optional server grade to pre-fill a fresh draft (revise flow); used
 *   only when no local draft exists.
 */
export function useGradingDraft(
  submissionId: string,
  seed?: () => GradingDraft,
): UseGradingDraftResult {
  const [draft, setDraftState] = useState<GradingDraft>(() => {
    const stored = readGradingDraft(submissionId)
    if (stored) return stored
    return seed ? seed() : emptyGradingDraft()
  })

  const setDraft = useCallback(
    (updater: (prev: GradingDraft) => GradingDraft) => {
      setDraftState((prev) => {
        const next = updater(prev)
        writeGradingDraft(submissionId, next)
        return next
      })
    },
    [submissionId],
  )

  const clear = useCallback(() => {
    clearGradingDraft(submissionId)
    setDraftState(seed ? seed() : emptyGradingDraft())
  }, [submissionId, seed])

  return { draft, setDraft, clear }
}
