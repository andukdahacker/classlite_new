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
 * Two visual modes:
 *
 * - **Interactive** (default) — the full pill set + a date-range button, the
 *   shell for the FUTURE live scope-switching / custom date-range wiring
 *   (FU-8-2-D). Scope-driven refetch + RBAC on scope changes land there. RBAC
 *   is the route layer's job (UX-3); `disabledScopes` only drives visual
 *   disablement.
 *
 * - **Presentational** (`presentational`) — the Story 8.2b `s45` reality (D7 /
 *   D15): the home endpoint takes NO scope param and the class axis is a fixed
 *   12-week window, so there is nothing to switch. The bar renders the
 *   role-derived scope as a STATIC label (not a toggle-looking pill) and the
 *   period as a STATIC label (not a dead date-range button) — "never looks like
 *   a control that isn't." The class-picker is the ONE live control (it
 *   navigates). Chosen over dead/disabled controls at party-mode 2026-09-21
 *   (Sally BLOCKER) and re-confirmed at code-review 2026-09-22 (D15 was not
 *   actually wired in v1.0).
 *
 * Class option labels are LITERAL user-authored class names, never i18n keys —
 * a name like "IELTS: Advanced" or "Level 6.5" must render verbatim (running it
 * through `t()` would mangle it on the `:`/`.` i18next separators).
 */
export type AnalyticsScope = 'mine' | 'all' | 'center-wide'

export interface ScopeBarClassOption {
  id: string
  /** Literal class name (user data), rendered verbatim — NOT an i18n key. */
  label: string
}

export interface ScopeBarProps {
  role: Role
  activeScope: AnalyticsScope
  /**
   * Presentational-honest mode (Story 8.2b D15): static scope + period labels,
   * no toggle pills, no dead date-range button. The class-picker stays live.
   */
  presentational?: boolean
  disabledScopes?: ReadonlyArray<AnalyticsScope>
  selectedClassId?: string | null
  classOptions: ReadonlyArray<ScopeBarClassOption>
  /** ISO date strings — never `new Date()` per TS-6. */
  dateRange: { startIso: string; endIso: string }
  onScopeChange?: (scope: AnalyticsScope) => void
  onClassChange?: (classId: string | null) => void
  /**
   * No-op in the static shell. Calendar Range integration ships with the
   * live-scope FU (FU-8-2-D) — the prop is declared here so the future wiring
   * has a stable contract to land against.
   */
  onDateRangeChange?: (range: { startIso: string; endIso: string }) => void
  /** Display label for the date range / period — pre-formatted by the consumer. */
  dateRangeLabel?: string
}

const SCOPE_PILLS: ReadonlyArray<{ value: AnalyticsScope; labelKey: string }> = [
  { value: 'mine', labelKey: 'scopeBar.scope.mine' },
  { value: 'all', labelKey: 'scopeBar.scope.all' },
  { value: 'center-wide', labelKey: 'scopeBar.scope.centerWide' },
]

const SCOPE_LABEL_KEY: Record<AnalyticsScope, string> = {
  mine: 'scopeBar.scope.mine',
  all: 'scopeBar.scope.all',
  'center-wide': 'scopeBar.scope.centerWide',
}

export function ScopeBar({
  role,
  activeScope,
  presentational = false,
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
      data-presentational={presentational ? 'true' : 'false'}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card px-3 py-2"
      role="toolbar"
      aria-label={t('scopeBar.label')}
    >
      {presentational ? (
        // D15 — a static, role-derived scope label. No pills, no aria-pressed:
        // there is no second scope to switch to in v1, so nothing pretends to be
        // a control.
        <span
          data-testid="scope-bar-scope-label"
          className="inline-flex items-center rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground"
        >
          {t(SCOPE_LABEL_KEY[activeScope])}
        </span>
      ) : (
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
      )}

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
                {option.label}
              </SelectItem>
            ))
          )}
        </SelectContent>
      </Select>

      {presentational ? (
        // D15 — a static period label, NOT an interactive-looking date-range
        // button. The icon is decorative (aria-hidden); the custom range ships
        // in FU-8-2-D.
        <span
          data-testid="scope-bar-period-label"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
        >
          <CalendarIcon aria-hidden="true" className="size-3.5" />
          {resolvedLabel}
        </span>
      ) : (
        <Button
          variant="outline"
          size="sm"
          data-testid="scope-bar-date-range"
          aria-label={t('scopeBar.dateRange.aria')}
        >
          <CalendarIcon data-icon="inline-start" aria-hidden="true" />
          {resolvedLabel}
        </Button>
      )}
    </div>
  )
}
