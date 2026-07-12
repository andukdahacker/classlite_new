/**
 * TemplateCard — Story 2-3b AC2 pure card renderer.
 *
 * Consumed by TemplateSelectPage's `RadioGroupTiles` container — the
 * `RadioGroupTile` primitive owns the `role="radio"` + `aria-checked` +
 * `aria-label` semantics, this component owns the visual layout.
 */
import { useTranslation } from 'react-i18next'
import type { Template } from '../api/useListTemplates'

const SKILL_KEY_MAP: Record<Template['primarySkill'], string> = {
  writing: 'onboarding.template.skill.writing',
  speaking: 'onboarding.template.skill.speaking',
  listening: 'onboarding.template.skill.listening',
  reading: 'onboarding.template.skill.reading',
  listening_reading: 'onboarding.template.skill.listening_reading',
  all_skills: 'onboarding.template.skill.all_skills',
}

// R1-C2-P12 — named accent fallback (slate-500). Wire-value pass-through is
// documented; migration to a `--cl-template-*` token is tracked at FU-2-3a-C.
// eslint-disable-next-line no-restricted-syntax -- FU-2-3a-C token migration
const DEFAULT_TEMPLATE_ACCENT = '#64748b'

export interface TemplateCardProps {
  template: Template
  selected: boolean
}

export function TemplateCard({ template, selected }: TemplateCardProps) {
  const { t } = useTranslation()
  // Template accent color is a wire value (`Template.color` in api.yaml) —
  // Story 2.2 seeds ship literal hex values so the FE must pass them
  // through verbatim. Fallback is the named DEFAULT_TEMPLATE_ACCENT const.
  const accent = template.color ?? DEFAULT_TEMPLATE_ACCENT
  return (
    <div
      className={
        'flex h-full cursor-pointer flex-col gap-3 rounded-lg border p-5 transition-colors ' +
        (selected
          ? 'border-slate-900 bg-white shadow-sm'
          : 'border-slate-200 bg-white hover:border-slate-300')
      }
    >
      <div
        aria-hidden="true"
        className="h-1 w-12 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <h3 className="font-serif text-lg leading-tight">{template.name}</h3>
      <div className="mt-auto flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium">
          {t('onboarding.template.card.targetBand', { band: template.targetBand })}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">
          {t(SKILL_KEY_MAP[template.primarySkill])}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5">
          {t('onboarding.template.card.sessions', { n: template.sessionCount })}
        </span>
      </div>
      <div className="text-xs uppercase tracking-wide text-slate-500">
        {template.scope === 'system'
          ? t('onboarding.template.card.systemBadge')
          : t('onboarding.template.card.centerBadge')}
      </div>
    </div>
  )
}
