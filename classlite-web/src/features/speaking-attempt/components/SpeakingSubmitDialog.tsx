/**
 * SpeakingSubmitDialog — Story 5.4 Task 7 (AC18, Sally B3). Submit confirmation: a
 * dialog on desktop, a slide-up SHEET on mobile. Confirms has-recording + duration
 * and the late policy. A sub-threshold / silent take (`durationSec < MIN`, or no
 * recording at all) shows a NON-BLOCKING "no usable recording — submit anyway?"
 * warning (a silent Blob must not sail through). On a failed final flush it surfaces
 * the "couldn't save everything — retry" fallback.
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
import { formatRemaining } from '@/features/attempts'
import { SPEAKING_MIN_DURATION_SEC } from '../lib/speakingContent'

export interface SpeakingSubmitDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  isDesktop: boolean
  /** True when a recording has been captured (and uploaded or pending upload). */
  hasRecording: boolean
  /** The take length in seconds (0 when none). */
  durationSec: number
  isLate: boolean
  latePenalty: number
  onConfirm: () => void
  /** Retry-dialog escape (AC20): finalize keyless when the take's upload keeps
   *  failing. Provided only in retry mode when a take exists. */
  onSubmitWithoutAudio?: () => void
  submitting: boolean
  retry?: boolean
}

export function SpeakingSubmitDialog({
  open,
  onOpenChange,
  isDesktop,
  hasRecording,
  durationSec,
  isLate,
  latePenalty,
  onConfirm,
  onSubmitWithoutAudio,
  submitting,
  retry = false,
}: SpeakingSubmitDialogProps) {
  const { t } = useTranslation()
  const unusable = !hasRecording || durationSec < SPEAKING_MIN_DURATION_SEC
  const title = retry ? t('speaking.submit.retryTitle') : t('speaking.submit.title')
  const body = retry ? t('speaking.submit.retryBody') : t('speaking.submit.body')
  const confirmLabel = retry ? t('speaking.submit.retry') : t('speaking.submit.confirm')

  const details = (
    <div className="flex flex-col gap-2" data-testid="speaking-submit-details">
      {hasRecording ? (
        <p
          data-testid="speaking-submit-duration"
          className="text-sm tabular-nums text-[color:var(--cl-ink)]"
        >
          {t('speaking.submit.hasRecording', { time: formatRemaining(durationSec) })}
        </p>
      ) : null}
      {unusable ? (
        <p
          role="note"
          data-testid="speaking-submit-nousable"
          className="text-sm text-[color:var(--cl-amber)]"
        >
          {t('speaking.submit.noUsable')}
        </p>
      ) : null}
      {isLate ? (
        <p
          role="note"
          data-testid="speaking-submit-late"
          className="text-sm text-[color:var(--cl-amber)]"
        >
          {t('speaking.submit.late', { penalty: latePenalty })}
        </p>
      ) : null}
    </div>
  )

  if (isDesktop) {
    return (
      <AlertDialog open={open} onOpenChange={onOpenChange}>
        <AlertDialogContent data-testid="speaking-submit-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>{title}</AlertDialogTitle>
            <AlertDialogDescription>{body}</AlertDialogDescription>
          </AlertDialogHeader>
          {details}
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => onOpenChange(false)}>
              {t('speaking.submit.cancel')}
            </AlertDialogCancel>
            {onSubmitWithoutAudio ? (
              <Button
                type="button"
                variant="outline"
                onClick={onSubmitWithoutAudio}
                disabled={submitting}
                data-testid="speaking-submit-without-audio"
              >
                {t('speaking.submit.withoutAudio')}
              </Button>
            ) : null}
            <AlertDialogAction
              onClick={onConfirm}
              disabled={submitting}
              data-testid="speaking-submit-confirm"
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
      <DrawerContent data-testid="speaking-submit-sheet">
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
            data-testid="speaking-submit-confirm"
            className="min-h-12 text-base"
          >
            {confirmLabel}
          </Button>
          {onSubmitWithoutAudio ? (
            <Button
              type="button"
              variant="outline"
              onClick={onSubmitWithoutAudio}
              disabled={submitting}
              data-testid="speaking-submit-without-audio"
              className="min-h-12 text-base"
            >
              {t('speaking.submit.withoutAudio')}
            </Button>
          ) : null}
          <DrawerClose
            className="min-h-11 text-sm text-[var(--cl-ink-soft)]"
            data-testid="speaking-submit-cancel"
          >
            {t('speaking.submit.cancel')}
          </DrawerClose>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  )
}
