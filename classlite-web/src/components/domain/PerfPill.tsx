/**
 * PerfPill — Story 7.2b (D8). A performance-status badge for the student
 * surface, distinct from the lifecycle `StatusPill` (active/pending/archived).
 * The student "Status" column and the detail head communicate PERFORMANCE:
 * good / on-track / at-risk, plus the s42 `unassigned` treatment for a student
 * with no active enrollment.
 *
 * NOT a retrofit of `StatusPill` — the semantics differ (performance vs
 * lifecycle) and the UX names a distinct pill (D8, a targeted addition per
 * [[feedback_pragmatic_interpretation_of_spec_absolutes]]). Domain tier, no
 * feature imports (FW-7). Label resolves from `people.student.status.*` (never
 * a hardcoded string, UX-2). The `PerfTone` type + `perfToneFromStatus` mapper
 * live in `./perfTone` so this file stays component-only (react-refresh).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import type { PerfTone } from './perfTone'

const TONE_CLASS: Record<PerfTone, string> = {
  good: 'bg-[color:var(--cl-tint-green)] text-[color:var(--cl-green)]',
  normal: 'bg-slate-100 text-slate-600',
  'at-risk': 'bg-[color:var(--cl-tint-red)] text-[color:var(--cl-red)]',
  unassigned: 'bg-[color:var(--cl-tint-gold)] text-[color:var(--cl-amber)]',
}

const LABEL_KEY: Record<PerfTone, string> = {
  good: 'people.student.status.good',
  normal: 'people.student.status.normal',
  'at-risk': 'people.student.status.atRisk',
  unassigned: 'people.student.status.unassigned',
}

export interface PerfPillProps {
  tone: PerfTone
}

export function PerfPill({ tone }: PerfPillProps): ReactElement {
  const { t } = useTranslation()
  return (
    <Badge
      variant="secondary"
      className={TONE_CLASS[tone]}
      data-testid={`perf-pill-${tone}`}
    >
      {t(LABEL_KEY[tone])}
    </Badge>
  )
}
