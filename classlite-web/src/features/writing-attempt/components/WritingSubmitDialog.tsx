/**
 * WritingSubmitDialog — Story 5.3 Task 6 (AC7/AC15, Sally S1). The submit
 * confirmation: a dialog on desktop, a slide-up SHEET on mobile (s78). Shows the
 * word count, a NON-BLOCKING under-length warning when below the minimum (AC7 —
 * "you can still submit", never blocks), and the late-policy warning when past the
 * due date (AC15). Confirm runs the shared serialized finalizer; on a failed final
 * flush it surfaces the "couldn't save everything — retry" fallback rather than a
 * silent lossy submit.
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
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer'
import { Button } from '@/components/ui/button'

export interface WritingSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Render as a mobile slide-up sheet (false) or a desktop dialog (true). */
  isDesktop: boolean
  /** Word count snapshot at open time. */
  wordCount: number
  /** The client-side minimum (AC6/D3). */
  min: number
  /** True when submitting past the due date (AC15). */
  isLate: boolean
  /** The flat late penalty from the assignment (AC15). */
  latePenalty: number
  onConfirm: () => void
  submitting: boolean
  /** True when a prior finalize attempt failed to save everything (AC15). */
  retry?: boolean
}

export function WritingSubmitDialog({
  open,
  onOpenChange,
  isDesktop,
  wordCount,
  min,
  isLate,
  latePenalty,
  onConfirm,
  submitting,
  retry = false,
}: WritingSubmitDialogProps) {
  const { t } = useTranslation()
  const belowMin = wordCount < min
  const title = retry ? t('writing.submit.retryTitle') : t('writing.submit.title')
  const body = retry ? t('writing.submit.retryBody') : t('writing.submit.body')
  const confirmLabel = retry ? t('writing.submit.retry') : t('writing.submit.confirm')

  const details = (
    <div className="flex flex-col gap-2" data-testid="writing-submit-details">
      <p
        data-testid="writing-submit-word-count"
        className="text-sm text-[var(--cl-ink)] tabular-nums"
      >
        {t('writing.submit.wordCount', { n: wordCount })}
      </p>
      {belowMin ? (
        <p
          role="note"
          data-testid="writing-submit-underlength"
          className="text-sm text-[color:var(--cl-amber)]"
        >
          {t('writing.submit.underLength', { min })}
        </p>
      ) : null}
      {isLate ? (
        <p
          role="note"
          data-testid="writing-submit-late"
          className="text-sm text-[color:var(--cl-amber)]"
        >
          {t('writing.submit.late', { penalty: latePenalty })}
        </p>
      ) : null}
    </div>
  )

  if (isDesktop) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent data-testid="writing-submit-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          {details}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onOpenChange(false)}>
              {t('writing.submit.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirm}
              disabled={submitting}
              data-testid="writing-submit-confirm"
            >
              {confirmLabel}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    )
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent data-testid="writing-submit-sheet">
        <DrawerHeader>
          <DrawerTitle>{title}</DrawerTitle>
          <DrawerDescription>{body}</DrawerDescription>
        </DrawerHeader>
        <div className="px-4">{details}</div>
        <DrawerFooter>
          <Button
            type="button"
            onClick={onConfirm}
            disabled={submitting}
            data-testid="writing-submit-confirm"
            className="min-h-11"
          >
            {confirmLabel}
          </Button>
          <DrawerClose
            className="min-h-11 text-sm text-[var(--cl-ink-soft)]"
            data-testid="writing-submit-cancel"
          >
            {t('writing.submit.cancel')}
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
