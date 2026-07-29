/**
 * SectionTypePicker — Story 4.2 (AC2) + Story 4.3b (AC1). The five section cards
 * (Reading / Listening / Writing / Speaking / Grammar) plus — when `onGenerateAI`
 * is provided — a sixth "Generate section" AI card that opens the s17 dialog.
 * Selecting a type card appends an empty section of that type.
 */
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus, Sparkles } from 'lucide-react'
import { SECTION_TYPES, sectionTypeColor, sectionTypeLabelKey } from '../../lib/sectionTypes'
import type { ExerciseSectionType } from '../../lib/editorTypes'

export interface SectionTypePickerProps {
  onAdd: (type: ExerciseSectionType) => void
  /** Story 4.3b — opens the AI generate dialog in `section` mode. Omitted (e.g.
   * in isolation) hides the AI card, so 4.2 behaviour is unchanged. */
  onGenerateAI?: () => void
  /** Forwards to the first card so the page can return focus here after a
   * section delete (AC9 focus flow). React 19 — `ref` is a plain prop, no
   * `forwardRef`. (Review P3) */
  ref?: Ref<HTMLButtonElement>
}

export function SectionTypePicker({ onAdd, onGenerateAI, ref }: SectionTypePickerProps) {
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
      {onGenerateAI ? (
        <button
          type="button"
          onClick={onGenerateAI}
          className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/5 px-3 py-2 text-sm text-primary hover:bg-primary/10"
          data-testid="section-type-generate-ai"
        >
          <Sparkles className="size-3.5" aria-hidden="true" />
          {t('exercises.ai.generateSectionCard')}
        </button>
      ) : null}
    </div>
  )
}
