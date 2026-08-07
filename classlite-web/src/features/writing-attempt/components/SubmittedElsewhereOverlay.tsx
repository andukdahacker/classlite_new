/**
 * SubmittedElsewhereOverlay — Story 5.3 Task 6 (AC13, Sally S6). The BLOCKING
 * overlay a second tab shows when tab-1 submitted/finalized the attempt (learned
 * via the per-submission `BroadcastChannel`). It makes the editor unreachable,
 * moves focus to its primary action ("view result"), and announces itself
 * (`role="alertdialog"` + a polite live region). If this tab had unsaved newer
 * text, it warns plainly that the in-progress draft was NOT included (the
 * orphaned-tab-2 loss must not be silent).
 *
 * Distinct surface from the AC16 read-only case (an inline banner) — deliberately
 * a blocking overlay for the multi-tab case (D7).
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'

export interface SubmittedElsewhereOverlayProps {
  /** True when this tab had unsaved newer text at the time of the foreign submit. */
  hadUnsavedText: boolean
}

export function SubmittedElsewhereOverlay({
  hadUnsavedText,
}: SubmittedElsewhereOverlayProps) {
  const { t } = useTranslation()
  const primaryRef = useRef<HTMLAnchorElement>(null)

  // Move focus to the primary action so a keyboard / SR user is not stranded on
  // the now-inert editor (Sally S6/S7).
  useEffect(() => {
    primaryRef.current?.focus()
  }, [])

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="submitted-elsewhere-title"
      data-testid="submitted-elsewhere-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[color:var(--cl-paper)]/95 px-6 text-center backdrop-blur-sm"
    >
      <h1
        id="submitted-elsewhere-title"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        {t('writing.submittedElsewhere.title')}
      </h1>
      <p className="max-w-md text-[var(--cl-ink-soft)]">
        {t('writing.submittedElsewhere.body')}
      </p>
      {hadUnsavedText ? (
        <p
          role="alert"
          data-testid="submitted-elsewhere-orphan-warning"
          className="max-w-md text-sm text-[color:var(--cl-amber)]"
        >
          {t('writing.submittedElsewhere.orphanWarning')}
        </p>
      ) : null}
      <Link
        ref={primaryRef}
        to="/assignments"
        className={buttonVariants({ variant: 'default' })}
        data-testid="submitted-elsewhere-view-result"
      >
        {t('writing.submittedElsewhere.viewResult')}
      </Link>
      {/* Announce the takeover to screen readers (in addition to the alertdialog). */}
      <span role="status" aria-live="assertive" className="sr-only">
        {t('writing.submittedElsewhere.announce')}
      </span>
    </div>
  )
}
