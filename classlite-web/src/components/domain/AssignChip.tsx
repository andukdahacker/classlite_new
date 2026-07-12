/**
 * AssignChip — canonical Epic 1D 1d-7 debut. Story 2-3b Task 4.1 (Amelia-B1
 * fold pre-flight — grep-confirmed absent from `src/components/domain/`).
 *
 * Inline pill affordance for the teacher assignment slot in a class row.
 * Consumed by:
 *   - `ClassSpawnPage` — interactive states (`empty` / `assigned` / `invited`)
 *   - `SoloFirstClassPage` — `lockedTo="self"` variant renders a read-only
 *     `<div>` (AC8 — Solo teacher is hard-coded to the caller; there is no
 *     assign/invite affordance).
 *
 * Star icon (Founder AC7 auto-assign badge) uses a decorative
 * `data-testid="assign-chip-star" aria-hidden="true"` <span> per Sally-I4
 * discipline; screen readers announce the assigned name + role, not the
 * ★ glyph itself.
 *
 * ARIA contract: interactive states render a real `<button type="button">`
 * so keyboard + click semantics come for free. The `ariaLabel` prop
 * overrides the default state-derived label when the parent (e.g.
 * ClassSpawnPage row) wants richer context.
 */
import type { Ref } from 'react'
import { useTranslation } from 'react-i18next'
import { getInitials } from '@/features/onboarding/lib/letterMark'

export interface AssignChipValue {
  userId?: string
  email?: string
  displayName?: string
  role?: string
}

export interface AssignChipProps {
  state: 'empty' | 'assigned' | 'invited'
  value: AssignChipValue | null
  onOpenComposer: () => void
  onClear: () => void
  /** Overrides the default state-derived aria-label. */
  ariaLabel?: string
  /** Solo Teacher pill — renders as read-only `<div>`, click has no effect. */
  lockedTo?: 'self'
  /** Founder AC7 auto-assign — decorative star icon (aria-hidden). */
  starIcon?: boolean
  /**
   * React 19 refs-as-props — parent focus-return belts hook here.
   * R1-C2-P5: forwarded to the underlying element in BOTH branches
   * (`<button>` for interactive states, `<div>` for `lockedTo='self'`).
   * Callers can use `HTMLButtonElement | HTMLDivElement` if they need to
   * measure/focus the locked pill.
   */
  ref?: Ref<HTMLButtonElement | HTMLDivElement>
}

function defaultLabel(state: AssignChipProps['state'], value: AssignChipValue | null): string {
  if (state === 'empty') return 'Assign or invite a teacher'
  if (state === 'invited') return value?.email ? `Invited ${value.email}` : 'Invited teacher'
  if (value?.displayName) {
    return value.role
      ? `Assigned to ${value.displayName}, ${value.role}`
      : `Assigned to ${value.displayName}`
  }
  return 'Assigned teacher'
}

function labelContent(state: AssignChipProps['state'], value: AssignChipValue | null) {
  if (state === 'empty') {
    return (
      <>
        <span
          aria-hidden="true"
          className="text-slate-400"
          data-testid="assign-chip-plus"
        >
          +
        </span>
        <span className="text-slate-600">Assign or invite a teacher</span>
      </>
    )
  }
  if (state === 'invited') {
    return (
      <>
        <span className="text-slate-800">{value?.email ?? 'Invited teacher'}</span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
          pending
        </span>
      </>
    )
  }
  const initials = value?.displayName ? getInitials(value.displayName) : '??'
  return (
    <>
      <span
        aria-hidden="true"
        className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700"
      >
        {initials}
      </span>
      <span className="text-slate-900">{value?.displayName ?? 'Assigned'}</span>
      {value?.role ? (
        <span className="text-xs text-slate-500">· {value.role}</span>
      ) : null}
    </>
  )
}

const BASE_CLASS =
  'inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm'
const INTERACTIVE_CLASS =
  BASE_CLASS +
  ' border-dashed border-slate-300 bg-white hover:border-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900'
const LOCKED_CLASS = BASE_CLASS + ' border-solid border-slate-200 bg-slate-50'

export function AssignChip(props: AssignChipProps) {
  const { t } = useTranslation()
  const {
    state,
    value,
    onOpenComposer,
    onClear,
    ariaLabel,
    lockedTo,
    starIcon,
    ref,
  } = props
  const label = ariaLabel ?? defaultLabel(state, value)
  const content = labelContent(state, value)
  const star = starIcon ? (
    <span
      aria-hidden="true"
      data-testid="assign-chip-star"
      className="text-amber-500"
    >
      ★
    </span>
  ) : null

  // R1-C2-P5 — attach ref to the `<div>` variant so callers passing a ref
  // don't silently get `null`.
  if (lockedTo === 'self') {
    return (
      <div
        ref={ref as Ref<HTMLDivElement>}
        className={LOCKED_CLASS}
        aria-label={label}
      >
        {content}
        {star}
      </div>
    )
  }

  // R1-C2-P6 — wire the `onClear` prop. AC7 says "user CAN override the
  // display" — a small × affordance next to a non-empty pill is the
  // canonical clear affordance. Founder-auto-assign users clear this to
  // hand row 0 off to someone else. The clear button is a sibling of the
  // main trigger (not a child) so its click doesn't bubble to
  // `onOpenComposer`.
  const showClear = state !== 'empty'
  const buttonRef: Ref<HTMLButtonElement> | undefined =
    ref as Ref<HTMLButtonElement> | undefined
  return (
    <span className="inline-flex items-center gap-1">
      <button
        ref={buttonRef}
        type="button"
        className={INTERACTIVE_CLASS}
        aria-label={label}
        onClick={onOpenComposer}
      >
        {content}
        {star}
      </button>
      {showClear ? (
        <button
          type="button"
          data-testid="assign-chip-clear"
          aria-label={t('onboarding.spawn.teacher.clearAriaLabel')}
          onClick={onClear}
          className="rounded-full p-1 text-slate-400 hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900"
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </span>
  )
}
