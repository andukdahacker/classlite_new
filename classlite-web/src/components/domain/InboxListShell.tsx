import { useTranslation } from 'react-i18next'
import { X } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'

import type { Role } from '@/hooks/useRole'

import { InboxRow, type InboxRowData } from './InboxRow'

/**
 * InboxListShell — `s50` / `s51` / `s52` per-role inbox container.
 * Story 1d-4 AC6.
 *
 * Static visual identity only. Behavior — TanStack Query inbox polling,
 * action wiring, real notification routing — ships in Epic 10 Story 10.1.
 * Per UX-3, role variants ship as three separate Storybook stories
 * (`TeacherView` / `StudentView` / `AdminOwnerView`); the component itself
 * receives `role` as data and renders the same chrome — the row taxonomy
 * differs at the fixture layer.
 */
export interface InboxFilterChip {
  /** Stable key — also the i18n key used as the chip label. */
  key: string
  /** Optional count rendered alongside the label. */
  count?: number
}

export interface InboxListShellProps {
  rows: ReadonlyArray<InboxRowData>
  role: Role
  /** Filter chip definitions — chrome only, no actual filtering. */
  filters: ReadonlyArray<InboxFilterChip>
  /** Active filter chip keys — chrome only. */
  activeFilters: ReadonlyArray<string>
  onToggleFilter?: (key: string) => void
  onRowPrimaryAction?: (rowId: string) => void
  onRowArchive?: (rowId: string) => void
}

export function InboxListShell({
  rows,
  role,
  filters,
  activeFilters,
  onToggleFilter,
  onRowPrimaryAction,
  onRowArchive,
}: InboxListShellProps) {
  const { t } = useTranslation()
  // Defensive: drop active keys that no longer exist in `filters` so the
  // consumer's UI state never diverges from what the chrome can render.
  const filterKeys = new Set(filters.map((filter) => filter.key))
  const activeSet = new Set(activeFilters.filter((key) => filterKeys.has(key)))
  return (
    <section
      data-testid="inbox-list-shell"
      data-role={role}
      aria-label={t('inboxList.regionLabel')}
      className="flex flex-col rounded-2xl border border-[color:var(--cl-line-soft)] bg-card shadow-sm"
    >
      <header
        data-testid="inbox-list-shell-filters"
        className="flex flex-wrap items-center gap-2 border-b border-[color:var(--cl-line-soft)] px-4 py-3"
        aria-label={t('inboxList.filters.label')}
      >
        {filters.map((filter) => {
          const active = activeSet.has(filter.key)
          return (
            <button
              key={filter.key}
              type="button"
              data-testid={`inbox-list-shell-filter-${filter.key}`}
              data-active={active ? 'true' : 'false'}
              aria-pressed={active}
              onClick={() => onToggleFilter?.(filter.key)}
              className={cn(
                'inline-flex items-center gap-1 rounded-full border border-transparent px-2 py-0.5 text-xs font-medium transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
                active
                  ? 'bg-foreground text-background'
                  : 'bg-muted text-muted-foreground hover:bg-muted/70',
              )}
            >
              <span>{t(filter.key)}</span>
              {typeof filter.count === 'number' && filter.count > 0 ? (
                <Badge
                  variant={active ? 'outline' : 'secondary'}
                  className={cn(
                    'h-4 px-1.5 text-[0.65rem]',
                    active && 'border-background/40 text-background',
                  )}
                >
                  {filter.count}
                </Badge>
              ) : null}
              {active ? <X aria-hidden="true" className="size-3" /> : null}
            </button>
          )
        })}
      </header>
      {rows.length > 0 ? (
        <ul
          data-testid="inbox-list-shell-rows"
          aria-label={t('inboxList.rows.label')}
          className="flex flex-col"
        >
          {rows.map((row) => (
            <InboxRow
              key={row.id}
              row={row}
              role={role}
              onPrimaryAction={() => onRowPrimaryAction?.(row.id)}
              onArchive={() => onRowArchive?.(row.id)}
            />
          ))}
        </ul>
      ) : (
        <p
          data-testid="inbox-list-shell-empty"
          role="status"
          className="px-6 py-10 text-center text-sm text-muted-foreground"
        >
          {t('inboxList.empty')}
        </p>
      )}
    </section>
  )
}
