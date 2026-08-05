/**
 * SubmitConfirmDialog — Story 5.2b Task 8 (AC13, Sally-S1). On Submit, a dialog
 * shows answered / unanswered / flagged counts; the unanswered + flagged counts
 * are CLICKABLE — tapping jumps to the first such question (and closes the
 * dialog). Confirm runs the serialized finalizer (AC18); cancel returns. When
 * the finalize flush/submit fails, the dialog surfaces the "couldn't save
 * everything — retry" fallback rather than a silent lossy submit (AC18).
 */
import { useTranslation } from 'react-i18next'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

export interface SubmitConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  answered: number
  unanswered: number
  flagged: number
  onJumpUnanswered: () => void
  onJumpFlagged: () => void
  onConfirm: () => void
  submitting: boolean
  /** True when a prior finalize attempt failed to save everything (AC18). */
  retry?: boolean
}

export function SubmitConfirmDialog({
  open,
  onOpenChange,
  answered,
  unanswered,
  flagged,
  onJumpUnanswered,
  onJumpFlagged,
  onConfirm,
  submitting,
  retry = false,
}: SubmitConfirmDialogProps) {
  const { t } = useTranslation()

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent data-testid="submit-confirm-dialog">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {retry ? t('attempt.submit.retryTitle') : t('attempt.submit.title')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {retry ? t('attempt.submit.retryBody') : t('attempt.submit.body')}
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* AC17 — compact icon+number chips (full label is the aria-label +
            title/tooltip); `whitespace-nowrap` so VN never wrap-breaks at 360px
            (Sally-S4). The unanswered/flagged chips stay clickable jumps (AC13). */}
        <ul className="flex flex-wrap gap-2" data-testid="submit-counts">
          <li>
            <span
              data-testid="submit-answered"
              aria-label={t('attempt.submit.answered', { count: answered })}
              title={t('attempt.submit.answered', { count: answered })}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--cl-radius-full)] bg-[var(--cl-surface)] px-2.5 py-1 text-sm text-[var(--cl-ink)]"
            >
              <span aria-hidden="true">✓</span>
              <span className="tabular-nums">{answered}</span>
            </span>
          </li>
          <li>
            <button
              type="button"
              onClick={onJumpUnanswered}
              disabled={unanswered === 0}
              data-testid="submit-unanswered"
              aria-label={`${t('attempt.submit.unanswered', { count: unanswered })}${unanswered > 0 ? ` — ${t('attempt.submit.jumpUnanswered')}` : ''}`}
              title={t('attempt.submit.jumpUnanswered')}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--cl-radius-full)] bg-[var(--cl-danger)]/10 px-2.5 py-1 text-sm text-[var(--cl-danger)] underline-offset-2 hover:underline disabled:no-underline disabled:opacity-70"
            >
              <span aria-hidden="true">○</span>
              <span className="tabular-nums">{unanswered}</span>
            </button>
          </li>
          <li>
            <button
              type="button"
              onClick={onJumpFlagged}
              disabled={flagged === 0}
              data-testid="submit-flagged"
              aria-label={`${t('attempt.submit.flagged', { count: flagged })}${flagged > 0 ? ` — ${t('attempt.submit.jumpFlagged')}` : ''}`}
              title={t('attempt.submit.jumpFlagged')}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-[var(--cl-radius-full)] bg-[var(--cl-amber)]/10 px-2.5 py-1 text-sm text-[var(--cl-amber)] underline-offset-2 hover:underline disabled:no-underline disabled:opacity-70"
            >
              <span aria-hidden="true">⚑</span>
              <span className="tabular-nums">{flagged}</span>
            </button>
          </li>
        </ul>

        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => onOpenChange(false)}>
            {t('attempt.submit.cancel')}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={onConfirm}
            disabled={submitting}
            data-testid="submit-confirm"
          >
            {retry ? t('attempt.submit.retry') : t('attempt.submit.confirm')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
