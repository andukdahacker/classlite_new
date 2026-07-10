/**
 * RadioGroupTile — Story 2-3a Task 6.2 (Amelia-S2 fold).
 *
 * Unified custom radio primitive used by BOTH the persona cards AND the
 * brand-color swatches. Single implementation of WAI-ARIA APG radiogroup
 * semantics (roving tabindex, arrow-key navigation, `aria-checked`,
 * `aria-label`) prevents drift between the two consumers.
 *
 * React 19 API: refs are plain props (`ref={...}`), no `forwardRef` (per
 * project-context: React 19 rules).
 */
import {
  useRef,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react'

export interface RadioGroupTileProps<V extends string = string> {
  /** Stable identifier — the value written to the parent when this tile is
   * selected. Must be unique within a radiogroup. */
  value: V
  /** True when this tile is the current selection. */
  selected: boolean
  /** Announced by screen readers via `aria-label`. */
  ariaLabel: string
  /** Fires when the user clicks or presses Space/Enter on the tile.
   * Generic-preserved so callers do NOT need a runtime cast (R1-P23). */
  onSelect: (value: V) => void
  /** Arrow-key handler wired by the container. */
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void
  /** Roving tabindex from the container. */
  tabIndex: number
  children: ReactNode
  className?: string
  ref?: Ref<HTMLDivElement>
}

export function RadioGroupTile<V extends string = string>({
  value,
  selected,
  ariaLabel,
  onSelect,
  onKeyDown,
  tabIndex,
  children,
  className,
  ref,
}: RadioGroupTileProps<V>) {
  return (
    <div
      ref={ref}
      role="radio"
      aria-checked={selected}
      aria-label={ariaLabel}
      tabIndex={tabIndex}
      data-value={value}
      onClick={() => onSelect(value)}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault()
          onSelect(value)
          return
        }
        onKeyDown?.(event)
      }}
      className={className}
    >
      {children}
    </div>
  )
}

export interface RadioGroupTilesProps<V extends string> {
  ariaLabelledBy?: string
  ariaLabel?: string
  value: V | null
  onChange: (value: V) => void
  items: readonly {
    value: V
    ariaLabel: string
    render: (state: { selected: boolean }) => ReactNode
  }[]
  className?: string
  /** Tile className. Selected + unselected states are indicated via
   * `aria-checked` — Tailwind consumers can style with `[aria-checked="true"]`. */
  tileClassName?: string
}

export function RadioGroupTiles<V extends string>({
  ariaLabel,
  ariaLabelledBy,
  value,
  onChange,
  items,
  className,
  tileClassName,
}: RadioGroupTilesProps<V>) {
  const refs = useRef<Array<HTMLDivElement | null>>([])

  const selectedIndex =
    value === null ? -1 : items.findIndex((i) => i.value === value)

  // WAI-ARIA APG radio-group: focus lives on the currently-selected item.
  // When zero-selection is active (initial paint per AC1 Sally-B1), we still
  // want tab into the group to land on the first item — so tabIndex[0]=0 when
  // no selection exists.
  const tabbableIndex = selectedIndex === -1 ? 0 : selectedIndex

  const handleKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    idx: number,
  ) => {
    if (
      event.key === 'ArrowRight' ||
      event.key === 'ArrowDown' ||
      event.key === 'ArrowLeft' ||
      event.key === 'ArrowUp'
    ) {
      event.preventDefault()
      const dir =
        event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : -1
      const next = (idx + dir + items.length) % items.length
      onChange(items[next].value)
      // Move focus AFTER React re-renders with the new tabIndex.
      queueMicrotask(() => {
        const target = refs.current[next]
        if (!target) {
          // R1-P22: shrinking `items` between key press and microtask can
          // leave a null ref. Silent no-op previously; warn now so future
          // dynamic-list consumers see the hint.
          if (import.meta.env?.DEV) {
            console.warn(
              'RadioGroupTiles: focus target null at index',
              next,
              '(items likely mutated mid-key-nav)',
            )
          }
          return
        }
        target.focus()
      })
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      className={className}
    >
      {items.map((item, idx) => (
        <RadioGroupTile<V>
          key={item.value}
          ref={(el) => {
            refs.current[idx] = el
          }}
          value={item.value}
          selected={value === item.value}
          ariaLabel={item.ariaLabel}
          onSelect={onChange}
          onKeyDown={(event) => handleKeyDown(event, idx)}
          tabIndex={idx === tabbableIndex ? 0 : -1}
          className={tileClassName}
        >
          {item.render({ selected: value === item.value })}
        </RadioGroupTile>
      ))}
    </div>
  )
}
