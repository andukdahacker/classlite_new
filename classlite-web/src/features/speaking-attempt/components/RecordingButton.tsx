/**
 * RecordingButton — Story 5.4 Task 6 (AC7,21, s33). The primary record affordance:
 * a large round RED button, ≥64px so it is thumb-first on mobile, ≥16px label. Used
 * for the initial "Record" (idle) action; the live-recording Stop control is a
 * distinct element in the leaf carrying the elapsed `aria-label` (AC24).
 */
import { cn } from '@/lib/utils'

export interface RecordingButtonProps {
  onClick: () => void
  label: string
  disabled?: boolean
  'data-testid'?: string
}

export function RecordingButton({
  onClick,
  label,
  disabled = false,
  'data-testid': testId,
}: RecordingButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testId ?? 'speaking-record-button'}
      aria-label={label}
      className={cn(
        'flex min-h-16 min-w-16 items-center justify-center gap-2 rounded-full',
        'bg-[color:var(--cl-red)] px-6 text-base font-medium text-white',
        'shadow-sm transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-[color:var(--cl-red)] focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      <span aria-hidden="true" className="text-lg leading-none">
        ●
      </span>
      {label}
    </button>
  )
}
