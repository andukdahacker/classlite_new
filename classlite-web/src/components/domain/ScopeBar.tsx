import { useTranslation } from 'react-i18next'
import { Calendar as CalendarIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'

import type { Role } from '@/hooks/useRole'

/**
 * ScopeBar — `s45` / `s48` analytics scope strip per UX-DR29.
 * Story 1d-4 AC7.
 *
 * Static visual identity only. Behavior — scope-driven query refetch,
 * RBAC enforcement on scope changes — ships in Epic 8 Story 8.2. RBAC is
 * the route layer's job per UX-3 — this component's `disabledScopes`
 * only controls visual disablement.
 *
 * Teacher sees "My classes" / "All classes" (visual only); admin/owner
 * sees the full pill set including "Center-wide". The teacher's
 * "Center-wide" pill renders disabled, not absent, because the visual
 * affordance teaches the user that the scope EXISTS but is gated by
 * their role.
 */
export type AnalyticsScope = 'mine' | 'all' | 'center-wide'

export interface ScopeBarProps {
  role: Role
  activeScope: AnalyticsScope
  disabledScopes?: ReadonlyArray<AnalyticsScope>
  selectedClassId?: string | null
  classOptions: ReadonlyArray<{ id: string; nameKey: string }>
  /** ISO date strings — never `new Date()` per TS-6. */
  dateRange: { startIso: string; endIso: string }
  onScopeChange?: (scope: AnalyticsScope) => void
  onClassChange?: (classId: string | null) => void
  /**
   * No-op in the static shell. Calendar Range integration ships in
   * Epic 8 Story 8.2 — the prop is declared here so the future wiring
   * has a stable contract to land against.
   */
  onDateRangeChange?: (range: { startIso: string; endIso: string }) => void
  /** Display label for the date range — pre-formatted by the consumer. */
  dateRangeLabel?: string
}

const SCOPE_PILLS: ReadonlyArray<{ value: AnalyticsScope; labelKey: string }> = [
  { value: 'mine', labelKey: 'scopeBar.scope.mine' },
  { value: 'all', labelKey: 'scopeBar.scope.all' },
  { value: 'center-wide', labelKey: 'scopeBar.scope.centerWide' },
]

export function ScopeBar({
  role,
  activeScope,
  disabledScopes = [],
  selectedClassId,
  classOptions,
  dateRange,
  dateRangeLabel,
  onScopeChange,
  onClassChange,
}: ScopeBarProps) {
  const { t } = useTranslation()
  const disabledSet = new Set(disabledScopes)
  const resolvedLabel =
    dateRangeLabel ??
    t('scopeBar.dateRange.label', {
      start: dateRange.startIso.slice(0, 10),
      end: dateRange.endIso.slice(0, 10),
    })
  return (
    <div
      data-testid="scope-bar"
      data-role={role}
      data-active-scope={activeScope}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card px-3 py-2"
      role="toolbar"
      aria-label={t('scopeBar.label')}
    >
      <div
        role="group"
        aria-label={t('scopeBar.scope.label')}
        className="inline-flex items-center rounded-full bg-muted p-0.5"
      >
        {SCOPE_PILLS.map((pill) => {
          const active = pill.value === activeScope
          const disabled = disabledSet.has(pill.value)
          return (
            <button
              key={pill.value}
              type="button"
              disabled={disabled}
              data-testid={`scope-bar-pill-${pill.value}`}
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              onClick={() => onScopeChange?.(pill.value)}
              className={cn(
                'rounded-full px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                active
                  ? 'bg-foreground text-background shadow'
                  : 'text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {t(pill.labelKey)}
            </button>
          )
        })}
      </div>

      <Select
        value={selectedClassId || undefined}
        onValueChange={(value) => onClassChange?.(value)}
      >
        <SelectTrigger
          size="sm"
          data-testid="scope-bar-class-picker"
          aria-label={t('scopeBar.classPicker.label')}
        >
          <SelectValue placeholder={t('scopeBar.classPicker.placeholder')} />
        </SelectTrigger>
        <SelectContent>
          {classOptions.length === 0 ? (
            <SelectItem
              value="__none__"
              disabled
              data-testid="scope-bar-class-picker-empty"
            >
              {t('scopeBar.classPicker.noOptions')}
            </SelectItem>
          ) : (
            classOptions.map((option) => (
              <SelectItem key={option.id} value={option.id}>
                {t(option.nameKey)}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      <Button
        variant="outline"
        size="sm"
        data-testid="scope-bar-date-range"
        aria-label={t('scopeBar.dateRange.aria')}
      >
        <CalendarIcon data-icon="inline-start" aria-hidden="true" />
        {resolvedLabel}
      </Button>
    </div>
  )
}
