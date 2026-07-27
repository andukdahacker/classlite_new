/**
 * ContentSectionFrame — Story 3.5 shared shell for the three content sections.
 * Renders the section header + the always-visible add form, then the UX-1
 * trilogy for the list body: skeleton while loading, a human error + retry on
 * failure, a purpose-designed empty state, or the caller's list children.
 */
import { type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'

interface ContentSectionFrameProps {
  titleKey: string
  count: number
  isPending: boolean
  isError: boolean
  isEmpty: boolean
  onRetry: () => void
  emptyKey: string
  testid: string
  /** The add form, always rendered under the header (add works even when empty). */
  addForm: ReactNode
  /** The rendered list, shown only in the loaded non-empty state. */
  children: ReactNode
}

export function ContentSectionFrame({
  titleKey,
  count,
  isPending,
  isError,
  isEmpty,
  onRetry,
  emptyKey,
  testid,
  addForm,
  children,
}: ContentSectionFrameProps): ReactElement {
  const { t } = useTranslation()
  return (
    <section data-testid={testid} className="rounded-lg border border-slate-200 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-fraunces text-lg text-slate-900">{t(titleKey)}</h2>
        {!isPending && !isError && (
          <span className="text-xs text-slate-400" data-testid={`${testid}-count`}>
            {count}
          </span>
        )}
      </div>

      {addForm}

      <div className="mt-3">
        {isPending ? (
          <div data-testid={`${testid}-skeleton`} role="status" aria-busy="true" className="space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : isError ? (
          <div
            role="alert"
            data-testid={`${testid}-error`}
            className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
          >
            <span>{t('session.detail.content.loadError')}</span>
            <Button size="sm" variant="outline" onClick={onRetry}>
              {t('session.detail.content.retry')}
            </Button>
          </div>
        ) : isEmpty ? (
          <p data-testid={`${testid}-empty`} className="py-4 text-center text-sm text-slate-400">
            {t(emptyKey)}
          </p>
        ) : (
          children
        )}
      </div>
    </section>
  )
}
