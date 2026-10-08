/**
 * InboxStates — Story 10-1b (DD9 / AC2). The inbox Loading / Empty / Error
 * trilogy (UX-1). Mirrors `DashboardStates`: list-shaped skeleton rows (never a
 * spinner, `aria-busy`), an inline `role="alert"` error with a single retry
 * (never full-page), and a role-toned empty (s56) — a ghosted Inbox nav glyph +
 * a Fraunces headline whose ONE italic-accent word is the §6.4 brand signature +
 * a muted one-liner — NOT the generic centered gray "No data" AC2 forbids.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Inbox } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/domain/EmptyState'

/** The three empty "lenses" — student encouragement, teacher activation,
 *  owner/admin reassurance (admin shares the owner lens). */
export type InboxEmptyLens = 'student' | 'teacher' | 'ownerAdmin'

/** List-shaped skeleton rows mirroring a loaded inbox (UX-1 loading). */
export function InboxSkeleton(): ReactElement {
  return (
    <div data-testid="inbox-skeleton" aria-busy="true" className="space-y-3">
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

export interface InboxErrorAlertProps {
  /** Re-issues the inbox list query (TanStack Query `refetch`). */
  onRetry: () => void
}

/** Inline `role="alert"` with a single retry — the UX-1 error branch. */
export function InboxErrorAlert({ onRetry }: InboxErrorAlertProps): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-xl border border-[color:var(--cl-line-soft)] bg-card p-4 text-sm text-foreground"
    >
      <p>{t('inbox.error.message')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('inbox.error.retry')}
      </Button>
    </div>
  )
}

/**
 * InboxFilterEmpty — the empty state when an ACTIVE filter matches nothing but the
 * inbox is not truly empty (code-review 10-1b D2c). A neutral "no matches" line,
 * NOT the day-one role-toned encouragement copy (which would falsely tell a user
 * with notifications that their inbox is empty). The chip bar stays visible
 * (InboxListShell) so the filter can be cleared.
 */
export function InboxFilterEmpty(): ReactElement {
  const { t } = useTranslation()
  return (
    <p
      data-testid="inbox-filter-empty"
      role="status"
      className="px-6 py-10 text-center text-sm text-[color:var(--cl-ink-soft)]"
    >
      {t('inbox.filtered.empty')}
    </p>
  )
}

export interface InboxEmptyProps {
  lens: InboxEmptyLens
}

/** Role-toned empty state (s56) — ghost nav glyph + italic-accent headline + line.
 *  Re-platformed onto the canonical `EmptyState` (Story 10.3 AC3, the proving
 *  oracle): the role-decorator stays here (the component never calls `t()`), the
 *  `inbox-empty` test-id + `role="status"` (via `live`) + copy are preserved. */
export function InboxEmpty({ lens }: InboxEmptyProps): ReactElement {
  const { t } = useTranslation()
  return (
    <EmptyState
      data-testid="inbox-empty"
      live
      icon={<Inbox className="size-7" />}
      headline={t(`inbox.empty.${lens}.title`)}
      headlineAccent={t(`inbox.empty.${lens}.titleAccent`)}
      description={t(`inbox.empty.${lens}.body`)}
    />
  )
}
