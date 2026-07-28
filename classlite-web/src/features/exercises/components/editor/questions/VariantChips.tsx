/**
 * VariantChips — Story 4.2. The accepted-answer-variants editor (gap-fill /
 * short-answer). A removable chip per variant + an input that appends on Enter.
 * The parent owns the array; this is a controlled add/remove control.
 */
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'
import { Input } from '@/components/ui/input'

export interface VariantChipsProps {
  variants: string[]
  onChange: (next: string[]) => void
}

export function VariantChips({ variants, onChange }: VariantChipsProps) {
  const { t } = useTranslation()
  const [draft, setDraft] = useState('')

  function commit() {
    const value = draft.trim()
    if (value === '' || variants.includes(value)) {
      setDraft('')
      return
    }
    onChange([...variants, value])
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs text-muted-foreground">
        {t('exercises.editor.question.variantsLabel')}
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {variants.map((variant, i) => (
          <span
            key={`${variant}-${i}`}
            className="inline-flex items-center gap-1 rounded bg-accent px-2 py-0.5 text-xs"
            data-testid="variant-chip"
          >
            {variant}
            <button
              type="button"
              onClick={() => onChange(variants.filter((_, idx) => idx !== i))}
              aria-label={t('exercises.editor.question.removeVariant', { variant })}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" aria-hidden="true" />
            </button>
          </span>
        ))}
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
          }}
          onBlur={commit}
          placeholder={t('exercises.editor.question.addVariantPlaceholder')}
          className="h-7 w-32 text-xs"
          aria-label={t('exercises.editor.question.addVariantPlaceholder')}
          data-testid="variant-add-input"
        />
      </div>
    </div>
  )
}
