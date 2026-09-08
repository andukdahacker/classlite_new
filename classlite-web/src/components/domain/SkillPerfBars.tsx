/**
 * SkillPerfBars — Story 7.2b (D9). Renders the four IELTS skills
 * (`StudentPerSkill`) as label + fill bar + mono value rows. A `null` skill
 * renders an em-dash "—" — NEVER `0` (a missing band is not a zero band).
 *
 * Overrides the mockup's writing sub-criteria (Task response / Coherence / …):
 * those were assignment-scoped, but the whole-student detail surfaces the four
 * skills per 7-2a D6 (grammar/vocabulary/general are excluded from the
 * breakdown though still counted in `overallBand`). Skill labels render
 * `lang="en"` (§5.3 — IELTS terms stay English in both locales). Domain tier,
 * no feature imports (FW-7).
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Progress } from '@/components/ui/progress'
import type { components } from '@/lib/api/client'

// Sourced from the generated client (not the people feature) to honor the FW-7
// domain-tier boundary — no domain component reaches into a feature.
type StudentPerSkill = components['schemas']['StudentPerSkill']

/** IELTS band ceiling — bars are scaled band/BAND_MAX (CQ-3). */
const BAND_MAX = 9
const PERCENT = 100

const SKILLS = ['reading', 'listening', 'writing', 'speaking'] as const
type SkillKey = (typeof SKILLS)[number]

export interface SkillPerfBarsProps {
  perSkill: StudentPerSkill
}

export function SkillPerfBars({ perSkill }: SkillPerfBarsProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="space-y-3" data-testid="skill-perf-bars">
      {SKILLS.map((skill) => (
        <SkillRow key={skill} skill={skill} band={perSkill[skill]} label={t(`people.student.skill.${skill}`)} />
      ))}
    </div>
  )
}

function SkillRow({
  skill,
  band,
  label,
}: {
  skill: SkillKey
  band: number | null
  label: string
}): ReactElement {
  const { t } = useTranslation()
  const hasBand = band !== null
  const percent = hasBand ? (band / BAND_MAX) * PERCENT : 0
  return (
    <div className="flex items-center gap-3" data-testid={`skill-bar-${skill}`}>
      <span lang="en" className="w-20 shrink-0 text-sm text-slate-600">
        {label}
      </span>
      <Progress
        value={percent}
        aria-label={label}
        className="flex-1"
      />
      <span className="w-8 shrink-0 text-right font-mono text-sm text-slate-900">
        {hasBand ? band.toFixed(1) : t('people.student.band.empty')}
      </span>
    </div>
  )
}
