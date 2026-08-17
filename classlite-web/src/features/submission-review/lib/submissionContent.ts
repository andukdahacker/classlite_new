/**
 * submissionContent — narrow readers over the opaque `Submission.content`
 * (`Record<string, unknown>` on the wire) for the read-back components (Story
 * 5.5a). Each skill stores a distinct v1 shape (writing `{text}` · quiz
 * `{answers,flagged}` · speaking `{audioKey,contentType,durationSec}`); these
 * pull only the read-back-relevant fields and tolerate an absent/legacy field
 * (a missing key yields the empty value, never a throw).
 */
import type { components } from '@/lib/api/client'

type Submission = components['schemas']['Submission']

/** The speaking submission's playback-relevant fields (Story 5.4 shape). */
export interface SpeakingContent {
  audioKey: string | null
  contentType: string | null
  durationSec: number | null
}

/** The writing submission's plain-text body (Story 5.3 D1), or '' if absent. */
export function readWritingText(submission: Submission): string {
  const text = (submission.content as { text?: unknown }).text
  return typeof text === 'string' ? text : ''
}

/** The quiz submission's handle→answer map (Story 5.2b), or {} if absent. Only
 * string values are kept — a non-string stored answer (legacy/multi-select shape)
 * would otherwise reach the disabled inputs as `[object Object]`. */
export function readQuizAnswers(submission: Submission): Record<string, string> {
  const answers = (submission.content as { answers?: unknown }).answers
  if (!answers || typeof answers !== 'object') return {}
  const out: Record<string, string> = {}
  for (const [handle, value] of Object.entries(answers as Record<string, unknown>)) {
    if (typeof value === 'string') out[handle] = value
  }
  return out
}

/** The handles the student flagged for review (Story 5.2b `content.flagged`), as a
 * read-only set. Non-string entries are ignored; an absent field yields an empty set. */
export function readQuizFlagged(submission: Submission): ReadonlySet<string> {
  const flagged = (submission.content as { flagged?: unknown }).flagged
  if (!Array.isArray(flagged)) return new Set()
  return new Set(flagged.filter((handle): handle is string => typeof handle === 'string'))
}

/** The speaking submission's playback fields, each null when absent. */
export function readSpeakingContent(submission: Submission): SpeakingContent {
  const content = submission.content as {
    audioKey?: unknown
    contentType?: unknown
    durationSec?: unknown
  }
  return {
    audioKey: typeof content.audioKey === 'string' ? content.audioKey : null,
    contentType: typeof content.contentType === 'string' ? content.contentType : null,
    durationSec: typeof content.durationSec === 'number' ? content.durationSec : null,
  }
}
