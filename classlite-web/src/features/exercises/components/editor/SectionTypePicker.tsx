/**
 * SectionTypePicker — Story 4.2 (AC2). The five section cards
 * (Reading / Listening / Writing / Speaking / Grammar). NO AI "Generate
 * section" card (that is Story 4.3). Selecting a card appends an empty section
 * of that type.
 */
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { SECTION_TYPES, sectionTypeColor, sectionTypeLabelKey } from '../../lib/sectionTypes'
import type { ExerciseSectionType } from '../../lib/editorTypes'

export interface SectionTypePickerProps {
  onAdd: (type: ExerciseSectionType) => void
  /** Forwards to the first card so the page can return focus here after a
   * section delete (AC9 focus flow). React 19 — `ref` is a plain prop, no
   * `forwardRef`. (Review P3) */
  ref?: Ref<HTMLButtonElement>
}

export function SectionTypePicker({ onAdd, ref }: SectionTypePickerProps) {
  const { t } = useTranslation()
  return (
    <div
      className="flex flex-wrap gap-2"
      role="group"
      aria-label={t('exercises.editor.section.addSectionLabel')}
      data-testid="section-type-picker"
    >
      {SECTION_TYPES.map((type, i) => (
        <button
          key={type}
          ref={i === 0 ? ref : undefined}
          type="button"
          onClick={() => onAdd(type)}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
          data-testid={`section-type-add-${type}`}
        >
          <span
            aria-hidden="true"
            className="inline-block size-2.5 rounded-full"
            style={{ backgroundColor: sectionTypeColor(type) }}
          />
          <Plus className="size-3.5" aria-hidden="true" />
          {t(sectionTypeLabelKey(type))}
        </button>
      ))}
    </div>
  )
}
