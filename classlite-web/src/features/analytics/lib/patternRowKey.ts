/**
 * patternRowKey — the STABLE React list key for a mistake/pattern row (Story 8-3b,
 * code-review 2026-09-23 P4). The backend GROUP BY guarantees one row per
 * (patternSource, skillSource, criterion|questionType, type), so that composite is a
 * stable identity — NO array index. Keying on the index (the prior shape) made the
 * AC22 collision "fix" non-falsifiable AND mis-attached expand/scroll state to the
 * wrong row when the skill filter reorders the visible set.
 */
import type { MistakePattern } from './patternLabels'

export function patternRowKey(pattern: MistakePattern): string {
  return [
    pattern.patternSource,
    pattern.skillSource,
    pattern.criterion,
    pattern.questionType ?? '',
    pattern.type,
  ].join('|')
}
