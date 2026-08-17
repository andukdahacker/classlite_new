/**
 * SubmittedElsewhereOverlay — Story 5.4 Task 7 (AC17, D7). The BLOCKING overlay a
 * second tab shows when tab-1 finalized the attempt (learned via the per-submission
 * BroadcastChannel). Makes the recorder unreachable, moves focus to its primary
 * action, and announces itself. If this tab held an un-uploaded local recording, it
 * warns plainly it was NOT included (the orphaned local take must not be a silent
 * loss). Distinct from the AC19 read-only case (an inline banner) — deliberately a
 * blocking overlay for the multi-tab case.
 */
import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router'
import { buttonVariants } from '@/components/ui/button'

export interface SubmittedElsewhereOverlayProps {
  /** The assignment id — the "view result" link targets its review page (Story 5.5a). */
  assignmentId: string
  /** True when this tab held an un-uploaded recording at the foreign submit. */
  hadUnsavedRecording: boolean
}

export function SubmittedElsewhereOverlay({
  assignmentId,
  hadUnsavedRecording,
}: SubmittedElsewhereOverlayProps) {
  const { t } = useTranslation()
  const primaryRef = useRef<HTMLAnchorElement>(null)
  // The assertive region starts EMPTY in the DOM; we populate it after mount via an
  // imperative textContent write (a legitimate effect DOM sync, not React state) so
  // screen readers announce the CHANGE — content already present at initial render
  // is commonly not spoken. React owns no children of this node, so it is not
  // clobbered on re-render.
  const liveRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    primaryRef.current?.focus()
    if (liveRef.current) {
      liveRef.current.textContent = t('speaking.submittedElsewhere.announce')
    }
  }, [t])

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="speaking-submitted-elsewhere-title"
      data-testid="speaking-submitted-elsewhere-overlay"
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[color:var(--cl-paper)]/95 px-6 text-center backdrop-blur-sm"
    >
      <h1
        id="speaking-submitted-elsewhere-title"
        className="font-[var(--cl-font-display)] text-2xl text-[var(--cl-ink)]"
      >
        {t('speaking.submittedElsewhere.title')}
      </h1>
      <p className="max-w-md text-[var(--cl-ink-soft)]">
        {t('speaking.submittedElsewhere.body')}
      </p>
      {hadUnsavedRecording ? (
        <p
          role="alert"
          data-testid="speaking-submitted-elsewhere-orphan-warning"
          className="max-w-md text-sm text-[color:var(--cl-amber)]"
        >
          {t('speaking.submittedElsewhere.orphanWarning')}
        </p>
      ) : null}
      <Link
        ref={primaryRef}
        to={`/assignments/${assignmentId}/submission`}
        className={buttonVariants({ variant: 'default', className: 'h-12 px-6 text-base' })}
        data-testid="speaking-submitted-elsewhere-view-result"
      >
        {t('speaking.submittedElsewhere.viewResult')}
      </Link>
      <span ref={liveRef} role="status" aria-live="assertive" className="sr-only" />
    </div>
  )
}
