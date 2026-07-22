/**
 * MiniMonthNavigator — Story 3.4 (AC5). The shipped-but-unused shadcn
 * `calendar.tsx` (react-day-picker) as a month navigator. Clicking a date jumps
 * the grid to it (two-way sync: the grid's arrow-nav updates the selected date
 * back via the `selected` prop). The selected day carries aria-current="date".
 */
import { type ReactElement } from 'react'
import { Calendar } from '@/components/ui/calendar'

interface MiniMonthNavigatorProps {
  selected: Date
  onSelect: (date: Date) => void
}

export function MiniMonthNavigator({ selected, onSelect }: MiniMonthNavigatorProps): ReactElement {
  return (
    <div data-testid="schedule-mini-month">
      <Calendar
        mode="single"
        selected={selected}
        month={selected}
        onSelect={(date) => date && onSelect(date)}
        weekStartsOn={1}
      />
    </div>
  )
}
