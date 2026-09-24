/**
 * ShareSummaryButton — the UX-DR25 "Share summary" affordance for BOTH `s47` and
 * `s37` (Story 8-3b, Task 5, AC14/AC14a, D-SHARE). Two exports, ONE own-data-only
 * model (`buildShareSummaryModel`, R-C by construction):
 *   - Copy → `buildShareSummaryText` + guarded `navigator.clipboard?.writeText` +
 *     a success toast (the WritingGradingPage precedent).
 *   - Save as PDF → `window.print()` over a `@media print` one-page overlay (ZERO
 *     new dependency; renders Vietnamese natively — the jsPDF-flip rationale).
 * Labeled, keyboard-reachable, 44×44 controls with a busy state and a blame-free
 * error toast (§6.4 "never a broken result").
 */
import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { StudentPerformance } from '../api/useStudentPerformance'
import { buildShareSummaryModel } from '../lib/buildShareSummaryModel'
import { buildShareSummaryText } from '../lib/buildShareSummaryText'

export interface ShareSummaryButtonProps {
  perf: StudentPerformance
}

export function ShareSummaryButton({
  perf,
}: ShareSummaryButtonProps): ReactElement {
  const { t, i18n } = useTranslation()
  const [busy, setBusy] = useState(false)
  const model = useMemo(
    () => buildShareSummaryModel(perf, i18n.language),
    [perf, i18n.language],
  )
  const summaryText = useMemo(
    () => buildShareSummaryText(model, i18n.language),
    [model, i18n.language],
  )

  const onCopy = async (): Promise<void> => {
    // AC14a / code-review P3: AWAIT the write and gate the success toast on it —
    // the prior `void writeText(); toast.success()` reported success even when the
    // Clipboard API was absent (optional-chain no-op) or the write promise rejected
    // (permission denied), leaving an unhandled rejection + a lying toast.
    const clipboard = navigator.clipboard
    if (!clipboard) {
      toast.error(t('analytics.share.error'))
      return
    }
    try {
      await clipboard.writeText(summaryText)
      toast.success(t('analytics.share.copied'))
    } catch {
      toast.error(t('analytics.share.error'))
    }
  }

  const onPrint = (): void => {
    setBusy(true)
    try {
      window.print()
    } catch {
      toast.error(t('analytics.share.error'))
    } finally {
      setBusy(false)
    }
  }

  const controlClass =
    'inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-[var(--cl-border)] px-3 py-2 text-sm font-medium text-[var(--cl-ink)] hover:border-[var(--cl-ink-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60'

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="share-summary">
      <button
        type="button"
        data-testid="share-summary-copy"
        aria-label={t('analytics.share.copy')}
        onClick={() => {
          void onCopy()
        }}
        className={controlClass}
      >
        {t('analytics.share.copy')}
      </button>
      <button
        type="button"
        data-testid="share-summary-print"
        aria-label={t('analytics.share.exportPdf')}
        aria-busy={busy}
        disabled={busy}
        onClick={onPrint}
        className={controlClass}
      >
        {busy ? t('analytics.share.busy') : t('analytics.share.exportPdf')}
      </button>

      {/* One-page print overlay — hidden on screen, covers the page on print so
          window.print() yields a single branded summary (ZERO dep, vi-native). */}
      <div
        data-testid="share-print-summary"
        aria-hidden="true"
        className="hidden print:fixed print:inset-0 print:z-[9999] print:block print:bg-white print:p-10 print:text-black"
      >
        <h1 className="text-2xl font-semibold">{t('analytics.share.title')}</h1>
        <pre className="mt-4 whitespace-pre-wrap font-sans text-base">
          {summaryText}
        </pre>
      </div>
    </div>
  )
}
