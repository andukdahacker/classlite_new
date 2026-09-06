/**
 * AttendanceToggle — Story 3.5b (AC12/AC13 · D9/D11/UX-4). A per-row segmented
 * Present / Late / Absent control.
 *
 * - green / amber / red segments, `aria-pressed` on each, grouped under a
 *   `role="group"` with the row's accessible label.
 * - keyboard operable: Enter/Space select; ArrowLeft/Right/Up/Down move a roving
 *   focus across the three segments (the selected segment — or the first when
 *   unmarked — holds tabIndex 0).
 * - NO clear / un-mark affordance (D11 write-once-editable): a student only ever
 *   moves between the three states, never back to null.
 * - icon + label at every width (label sr-only under `sm` so the ~1.4×-wider
 *   Vietnamese labels fit at 360px, UX-4) with a 44×44 minimum touch target.
 *
 * The unmarked (null) state renders with NO segment pressed; the LOUD unmarked
 * treatment lives on the row (RosterTable `data-unmarked`), so the teacher's
 * "who haven't I gotten to yet" scan reads unmistakably.
 */
import { type ReactElement, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { components } from '@/lib/api/client'

// The three recordable states, sourced from the generated API type (not a
// feature) so this domain component honors FW-7 (no feature imports).
export type AttendanceStatus = components['schemas']['AttendanceStatus']

const STATUSES: readonly AttendanceStatus[] = ['present', 'late', 'absent']

// Pressed vs. idle class per status. Idle stays quiet; pressed carries the color.
const PRESSED_CLASS: Record<AttendanceStatus, string> = {
  present: 'bg-emerald-600 text-white border-emerald-600',
  late: 'bg-amber-500 text-white border-amber-500',
  absent: 'bg-red-600 text-white border-red-600',
}
const IDLE_CLASS: Record<AttendanceStatus, string> = {
  present: 'bg-white text-emerald-700 border-slate-200 hover:border-emerald-400',
  late: 'bg-white text-amber-700 border-slate-200 hover:border-amber-400',
  absent: 'bg-white text-red-700 border-slate-200 hover:border-red-400',
}

function StatusIcon({ status }: { status: AttendanceStatus }): ReactElement {
  const common = { viewBox: '0 0 24 24', className: 'h-4 w-4', fill: 'none', stroke: 'currentColor', strokeWidth: 2, 'aria-hidden': true } as const
  if (status === 'present') {
    return (
      <svg {...common}>
        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  if (status === 'late') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    )
  }
  return (
    <svg {...common}>
      <path d="M18 6L6 18M6 6l12 12" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

interface AttendanceToggleProps {
  value: AttendanceStatus | null
  onChange: (status: AttendanceStatus) => void
  disabled?: boolean
  groupLabel: string
}

export function AttendanceToggle({
  value,
  onChange,
  disabled = false,
  groupLabel,
}: AttendanceToggleProps): ReactElement {
  const { t } = useTranslation()
  const buttonsRef = useRef<(HTMLButtonElement | null)[]>([])

  // The roving-focus anchor: the selected segment, or the first when unmarked.
  const focusIndex = value ? STATUSES.indexOf(value) : 0

  function handleKeyDown(event: React.KeyboardEvent, index: number): void {
    let next: number
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      next = (index + 1) % STATUSES.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      next = (index - 1 + STATUSES.length) % STATUSES.length
    } else {
      return
    }
    event.preventDefault()
    buttonsRef.current[next]?.focus()
  }

  return (
    <div role="group" aria-label={groupLabel} className="inline-flex overflow-hidden rounded-md">
      {STATUSES.map((status, index) => {
        const pressed = value === status
        const label = t(`session.attendance.status.${status}`)
        return (
          <button
            key={status}
            ref={(el) => {
              buttonsRef.current[index] = el
            }}
            type="button"
            // aria-label keeps the accessible name stable even when the visible
            // label is hidden under `sm` (UX-4 — the icon alone is aria-hidden).
            aria-label={label}
            aria-pressed={pressed}
            disabled={disabled}
            tabIndex={index === focusIndex ? 0 : -1}
            onClick={() => onChange(status)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={[
              'inline-flex min-h-11 min-w-11 items-center justify-center gap-1.5 border px-2.5 text-sm font-medium transition-colors',
              '-ml-px first:ml-0 first:rounded-l-md last:rounded-r-md',
              'focus:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400',
              'disabled:cursor-not-allowed disabled:opacity-50',
              pressed ? PRESSED_CLASS[status] : IDLE_CLASS[status],
            ].join(' ')}
          >
            <StatusIcon status={status} />
            <span className="hidden sm:inline">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
