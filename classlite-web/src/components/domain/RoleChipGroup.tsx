/**
 * RoleChipGroup — Story 7.1b (D10). A segmented single-select of staff roles for
 * the s41 invite modal. Follows the shipped `AiChipGroup` idiom — plain
 * `aria-pressed` buttons rather than the Base-UI ToggleGroup — so selection is
 * caller-controlled and the chips stay trivially testable via role/testid
 * queries (the same reason `AiChipGroup` chose this shape).
 *
 * D12 (RULED Ducdo 2026-08-30): the invite modal offers Teacher / Admin ONLY,
 * for BOTH Owner and Admin senders — Owner-invite is deferred to a future
 * Settings co-owner surface, honoring 7-1a's single-owner-per-center invariant.
 * So `owner` is intentionally absent from the default option set; a per-option
 * `disabled` predicate remains for FR-11-style permission gating on future
 * reuse (s44 enrollment). Domain tier — no feature imports (FW-7).
 */
import type { ReactElement } from 'react'

export type ChipRole = 'teacher' | 'admin'

export interface RoleChipOption {
  value: ChipRole
  label: string
}

export interface RoleChipGroupProps {
  ariaLabel: string
  options: readonly RoleChipOption[]
  /** Currently-selected role, or null when nothing is chosen yet. */
  value: ChipRole | null
  onChange: (role: ChipRole) => void
  /** Per-option disable predicate (permission-driven; FR-11 hook). */
  isDisabled?: (role: ChipRole) => boolean
}

export function RoleChipGroup({
  ariaLabel,
  options,
  value,
  onChange,
  isDisabled,
}: RoleChipGroupProps): ReactElement {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={ariaLabel}>
      {options.map((option) => {
        const selected = value === option.value
        const disabled = isDisabled?.(option.value) ?? false
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={selected}
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-40 ${
              selected
                ? 'border-transparent bg-primary text-primary-foreground'
                : 'border-border hover:bg-accent'
            }`}
            data-testid={`role-chip-${option.value}`}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}
