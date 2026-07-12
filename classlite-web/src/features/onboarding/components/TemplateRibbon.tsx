/**
 * TemplateRibbon — Story 2-3b Task 7.2 (Sally-S6 fold).
 *
 * Horizontal scroll ribbon of TemplateCard tiles + optional "No template"
 * (Build-from-scratch) tile at end. Visible on load (NOT a collapsed
 * `<details>` disclosure — pattern-break inside a wizard step).
 *
 * Consumed by `SoloFirstClassPage`. If a shared card renderer emerges later
 * we can factor a common component; for v1 we intentionally keep this
 * component independent to avoid cross-chunk barrel leaks (Winston-S6).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { Template } from '../api/useListTemplates'
import { TemplateCard } from './TemplateCard'
import { BuildFromScratchTile } from './BuildFromScratchTile'
import { RadioGroupTiles } from './RadioGroupTile'

const NO_TEMPLATE_VALUE = '__no_template__'

export interface TemplateRibbonProps {
  templates: Template[]
  selectedValue: string | null
  onChange: (value: string | null, buildFromScratch: boolean) => void
}

export function TemplateRibbon({
  templates,
  selectedValue,
  onChange,
}: TemplateRibbonProps) {
  const { t } = useTranslation()
  // R1-C2-P13 — memoize items so `RadioGroupTiles` (or any downstream memo)
  // doesn't bust identity every render.
  const items = useMemo(
    () => [
      ...templates.map((template) => ({
        value: template.id,
        ariaLabel: template.name,
        render: ({ selected }: { selected: boolean }) => (
          <TemplateCard template={template} selected={selected} />
        ),
      })),
      {
        value: NO_TEMPLATE_VALUE,
        ariaLabel: t('onboarding.template.buildFromScratch.title'),
        render: ({ selected }: { selected: boolean }) => (
          <BuildFromScratchTile selected={selected} />
        ),
      },
    ],
    [templates, t],
  )
  return (
    <div
      data-testid="solo-template-ribbon"
      className="mt-4 -mx-4 overflow-x-auto px-4"
    >
      <RadioGroupTiles<string>
        ariaLabel={t('onboarding.solo.templatePickDetails')}
        value={selectedValue ?? NO_TEMPLATE_VALUE}
        onChange={(v) => {
          if (v === NO_TEMPLATE_VALUE) onChange(null, true)
          else onChange(v, false)
        }}
        items={items}
        className="flex min-w-0 gap-4"
        tileClassName="min-w-[220px]"
      />
    </div>
  )
}
