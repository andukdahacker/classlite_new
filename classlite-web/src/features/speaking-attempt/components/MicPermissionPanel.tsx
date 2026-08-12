/**
 * MicPermissionPanel — Story 5.4 Task 6 (AC10, Sally S4). A blame-free orientation
 * panel for a record-arm failure — NOT a bare 403. Branches on the failure kind
 * (permission-denied / no-device / device-busy / unsupported) for a specific
 * headline + body, and ALWAYS appends a generic fallback line ("Allow the
 * microphone for this site in your browser's settings") so a UA mis-detect or a
 * redesigned browser menu still lands the student somewhere true. All copy is i18n,
 * both locales. Not shown for a mid-recording interruption (that is a distinct
 * panel, AC11).
 */
import { useTranslation } from 'react-i18next'
import type { RecorderErrorKind } from '../hooks/useMediaRecorder'

export interface MicPermissionPanelProps {
  kind: Exclude<RecorderErrorKind, 'interrupted'>
  /** Retry arming the mic (re-request permission). Omitted for `unsupported`. */
  onRetry?: () => void
}

const COPY: Record<
  MicPermissionPanelProps['kind'],
  { titleKey: string; bodyKey: string; showGenericFallback: boolean }
> = {
  'permission-denied': {
    titleKey: 'speaking.mic.denied.title',
    bodyKey: 'speaking.mic.denied.body',
    showGenericFallback: true,
  },
  'no-device': {
    titleKey: 'speaking.mic.notFound.title',
    bodyKey: 'speaking.mic.notFound.body',
    showGenericFallback: true,
  },
  'device-busy': {
    titleKey: 'speaking.mic.busy.title',
    bodyKey: 'speaking.mic.busy.body',
    showGenericFallback: true,
  },
  unsupported: {
    titleKey: 'speaking.unsupported.title',
    bodyKey: 'speaking.unsupported.body',
    showGenericFallback: false,
  },
  unknown: {
    titleKey: 'speaking.mic.denied.title',
    bodyKey: 'speaking.mic.denied.body',
    showGenericFallback: true,
  },
}

export function MicPermissionPanel({ kind, onRetry }: MicPermissionPanelProps) {
  const { t } = useTranslation()
  const copy = COPY[kind]
  return (
    <div
      role="alert"
      data-testid="speaking-mic-panel"
      data-kind={kind}
      className="flex flex-col items-center gap-3 rounded-md border border-[color:var(--cl-line-soft)] bg-[color:var(--cl-tint-red)] p-4 text-center"
    >
      <h2 className="text-base font-semibold text-[color:var(--cl-ink)]">{t(copy.titleKey)}</h2>
      <p className="max-w-sm text-sm text-[color:var(--cl-ink-soft)]">{t(copy.bodyKey)}</p>
      {copy.showGenericFallback ? (
        <p
          data-testid="speaking-mic-generic-fallback"
          className="max-w-sm text-sm text-[color:var(--cl-ink-soft)]"
        >
          {t('speaking.mic.genericFallback')}
        </p>
      ) : null}
      {onRetry && kind !== 'unsupported' ? (
        <button
          type="button"
          onClick={onRetry}
          data-testid="speaking-mic-retry"
          className="min-h-12 rounded-md bg-[color:var(--cl-red)] px-4 text-base font-medium text-white hover:opacity-90"
        >
          {t('speaking.mic.retry')}
        </button>
      ) : null}
    </div>
  )
}
