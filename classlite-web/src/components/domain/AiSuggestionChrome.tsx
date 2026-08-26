import { useTranslation } from 'react-i18next'

import { cn } from '@/lib/utils'

/**
 * AiSuggestionChrome — Story 6.3c (T3). The shared visual chrome for AI grade-suggestion
 * surfaces: the gradient "AI" avatar and the teacher-only High/Medium confidence badge.
 * Extracted from the shipped 6.2b `AIGradeSuggestion` so the Writing (`grading.ai.*`)
 * and Speaking (`speakingGrading.ai.*`) surfaces share ONE avatar + badge instead of
 * twinning the markup (the story sanctions "extract to a shared spot if cleaner").
 *
 * The ONLY skill difference is the i18n key namespace, so `ConfidenceBadge` takes a
 * `keyPrefix` — its default (`grading.ai.confidence`) keeps every shipped Writing call
 * site byte-identical; Speaking passes `speakingGrading.ai.confidence`.
 *
 * Confidence renders on the TEACHER side ONLY (UX-DR22) — these components never send
 * anything anywhere; the parent's accept handler drops confidence at the merge boundary.
 */

export type AiConfidence = 'high' | 'medium'

/** The gradient "AI" avatar — distinguishes an AI card from the teacher's dark "You". */
export function AiAvatar({ label }: { label: string }) {
  return (
    <span
      data-testid="ai-avatar"
      aria-hidden="true"
      className="inline-flex size-6 items-center justify-center rounded-full bg-gradient-to-r from-fuchsia-500 to-indigo-500 text-[0.625rem] font-semibold text-white"
    >
      {label}
    </span>
  )
}

/** The teacher-only High/Medium confidence badge. `keyPrefix` selects the i18n namespace
 * (`grading.ai.confidence` for Writing — the default — or `speakingGrading.ai.confidence`
 * for Speaking); the resolved key is `${keyPrefix}.${confidence}`. */
export function ConfidenceBadge({
  confidence,
  keyPrefix = 'grading.ai.confidence',
}: {
  confidence: AiConfidence
  keyPrefix?: string
}) {
  const { t } = useTranslation()
  return (
    <span
      data-testid="ai-confidence"
      className={cn(
        'rounded-full px-2 py-0.5 text-[0.625rem] font-medium uppercase tracking-wide',
        confidence === 'high'
          ? 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]'
          : 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
      )}
    >
      {t(`${keyPrefix}.${confidence}`)}
    </span>
  )
}
