/**
 * AiChipGroup — Story 4.3b. An accessible chip row for the generate dialog's
 * controlled toggles (section type / band / count / mix). Plain `aria-pressed`
 * buttons (the editor's own `SectionTypePicker` idiom) rather than the Base-UI
 * ToggleGroup, so single- and multi-select share one selection-agnostic
 * component and stay trivially testable via role queries.
 *
 * Selection semantics live with the caller: `selected(option)` decides pressed
 * state and `onToggle(option)` applies the change, so the same component drives
 * a single-value chip (section type) and a multi-value chip row (question mix).
 */
export interface AiChipGroupProps<T extends string | number> {
  ariaLabel: string
  options: readonly T[]
  selected: (option: T) => boolean
  onToggle: (option: T) => void
  renderLabel: (option: T) => string
  /** Stable per-option test id + key (`${testIdPrefix}-${option}`). */
  testIdPrefix: string
  disabled?: boolean
}

export function AiChipGroup<T extends string | number>({
  ariaLabel,
  options,
  selected,
  onToggle,
  renderLabel,
  testIdPrefix,
  disabled = false,
}: AiChipGroupProps<T>) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const isSelected = selected(option)
        return (
          <button
            key={String(option)}
            type="button"
            aria-pressed={isSelected}
            disabled={disabled}
            onClick={() => onToggle(option)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
              isSelected
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border hover:bg-accent'
            }`}
            data-testid={`${testIdPrefix}-${option}`}
          >
            {renderLabel(option)}
          </button>
        )
      })}
    </div>
  )
}
