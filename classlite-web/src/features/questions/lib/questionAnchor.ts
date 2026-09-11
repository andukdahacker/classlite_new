/**
 * questionAnchor — the frontend half of the 7-4a positional anchor model (Story
 * 7.4b, AC2/AC14). Maps the attempt UI's `si:gi:qi` handle and a passage char
 * span to the wire `QuestionAnchor`, and derives the pin tone (orange item /
 * blue exercise, UX:370).
 *
 * Handle parsing is re-implemented here (the trivial, stable `si:gi:qi` format)
 * rather than importing quiz-attempt internals — features stay decoupled (TS-7);
 * the panel receives the current handle as a prop from the attempt shell.
 *
 * `schemaVersion` is server-owned (readOnly, stamped to 1 on write); we send a
 * placeholder `1` only to satisfy the generated type — the server re-stamps it.
 */
import type { QuestionAnchor, QuestionAnchorType } from '../api/useQuestions'

const HANDLE_RE = /^(\d+):(\d+):(\d+)$/

/** Parsed `si:gi:qi` handle, or null when the string is malformed. */
export function parseAttemptHandle(
  handle: string,
): { sectionIndex: number; questionGroupIndex: number; questionIndex: number } | null {
  const match = HANDLE_RE.exec(handle)
  if (!match) return null
  return {
    sectionIndex: Number(match[1]),
    questionGroupIndex: Number(match[2]),
    questionIndex: Number(match[3]),
  }
}

/** Build an item anchor from an attempt handle (AC2 "Attach to: This item"). */
export function itemAnchorFromHandle(handle: string): QuestionAnchor | null {
  const parsed = parseAttemptHandle(handle)
  if (!parsed) return null
  return {
    schemaVersion: 1,
    sectionIndex: parsed.sectionIndex,
    questionGroupIndex: parsed.questionGroupIndex,
    questionIndex: parsed.questionIndex,
    charStart: null,
    charEnd: null,
  }
}

/** Build a passage-span anchor from a selection (AC2 "select passage text"). */
export function passageAnchor(
  sectionIndex: number,
  charStart: number,
  charEnd: number,
): QuestionAnchor {
  return {
    schemaVersion: 1,
    sectionIndex,
    questionGroupIndex: null,
    questionIndex: null,
    charStart,
    charEnd,
  }
}

/**
 * Pin tone (AC2/AC14): item anchors are orange, whole-exercise anchors are blue.
 * A tone token the QuestionAnchorPin / card map to Tailwind classes.
 */
export type QuestionPinTone = 'item' | 'exercise'

export function pinToneFor(anchorType: QuestionAnchorType): QuestionPinTone {
  return anchorType === 'item' ? 'item' : 'exercise'
}
