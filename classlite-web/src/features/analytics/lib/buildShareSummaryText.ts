/**
 * buildShareSummaryText — a Zalo/WhatsApp-friendly plain-text block derived SOLELY
 * from the ShareSummaryModel (Story 8-3b, Task 5, AC14). It renders in the caller's
 * locale via `i18n.getFixedT(locale)` — Vietnamese diacritics survive verbatim
 * (the jsPDF-flip rationale: window.print()/plain text render vi natively, jsPDF
 * cannot without a heavy embedded font). No peer/cohort field can appear here
 * because the model carries none.
 */
import i18n from '@/lib/i18n'
import { formatBandOrDash, formatOrDash } from '@/lib/analytics/formatBand'
import type { ShareSummaryModel } from './buildShareSummaryModel'

export function buildShareSummaryText(
  model: ShareSummaryModel,
  locale: string,
): string {
  // Reuse the SAME null-vs-0 / locale-aware formatters the on-screen Overview uses
  // (code-review P6) — so a band renders "6,5" in vi and "6.5" in en identically on
  // screen and in the copied/printed summary, and a null becomes the localized "—"
  // (a resolved i18n key), never a hardcoded dash or a divergent Math.round percent.
  const t = i18n.getFixedT(locale)
  const lines: string[] = [model.studentName]
  lines.push(
    t('analytics.share.line.overallBand', {
      band: formatBandOrDash(model.overallBand),
    }),
  )
  if (model.targetBand !== null) {
    lines.push(
      t('analytics.share.line.goal', {
        band: formatBandOrDash(model.targetBand),
      }),
    )
  }
  for (const skill of model.perSkillBands) {
    lines.push(
      t('analytics.share.line.skill', {
        skill: t(`people.student.skill.${skill.skill}`),
        band: formatBandOrDash(skill.band),
      }),
    )
  }
  if (model.onTimeRate !== null) {
    lines.push(
      t('analytics.share.line.onTime', {
        value: formatOrDash(model.onTimeRate, { style: 'percent' }),
      }),
    )
  }
  lines.push(
    t('analytics.share.line.graded', { count: model.gradedSubmissionCount }),
  )
  return lines.join('\n')
}
