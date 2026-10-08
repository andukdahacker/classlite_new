/**
 * ArchiveStates — Story 10.2 (AC8). The archive Loading / Empty / Error trilogy
 * (UX-1). Mirrors InboxStates: list-shaped skeleton rows (never a spinner), an
 * inline `role="alert"` error with a single retry (never full-page), and a
 * role-toned-neutral empty (s60) — a ghosted Archive glyph + a Fraunces headline
 * whose ONE italic-accent word is the §6.4 brand signature + a muted one-liner,
 * NOT the generic centered gray "No data".
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Archive } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/domain/EmptyState'

/** List-shaped skeleton rows mirroring a loaded archive table (UX-1 loading). */
export function ArchiveSkeleton(): ReactElement {
  return (
    <div data-testid="archive-skeleton" aria-busy="true" className="space-y-3">
      <div className="h-8 w-56 animate-pulse rounded bg-slate-200" />
      <div className="flex flex-col gap-2 rounded-2xl border border-[color:var(--cl-line-soft)] bg-card p-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="flex items-start gap-3 py-2">
            <div className="size-8 shrink-0 animate-pulse rounded-full bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-slate-200" />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export interface ArchiveErrorAlertProps {
  /** Re-issues the archive list query (TanStack Query `refetch`). */
  onRetry: () => void
}

/** Inline `role="alert"` with a single retry — the UX-1 error branch. */
export function ArchiveErrorAlert({ onRetry }: ArchiveErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4 text-sm text-foreground"
    >
      <p>{t('archive.error.message')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('archive.error.retry')}
      </Button>
    </div>
  )
}

/** Role-toned empty state (s60) — ghost Archive glyph + italic-accent headline + line.
 *  Re-platformed onto the canonical `EmptyState` (Story 10.3 AC3, the second
 *  oracle): no actions, `archive-empty` test-id + `role="status"` (via `live`) +
 *  copy preserved; the component never calls `t()`. */
export function ArchiveEmpty(): ReactElement {
  const { t } = useTranslation()
  return (
    <EmptyState
      data-testid="archive-empty"
      live
      icon={<Archive className="size-7" />}
      headline={t('archive.empty.title')}
      headlineAccent={t('archive.empty.titleAccent')}
      description={t('archive.empty.body')}
    />
  )
}
