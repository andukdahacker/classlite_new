import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'

/**
 * EmptyStatePlaceholder — Story 1d-1 AC3.
 *
 * Pre-Epic-10 stand-in for the real `EmptyState` component. Stories
 * authored in Epic 1D (1d-2 / 1d-3) need an `Empty` export per UX-DR24's
 * Loading / Empty / Error trilogy, but the canonical `EmptyState` ships in
 * Epic 10 Story 10.3. This placeholder unblocks Epic 1D without forking
 * the spec: when 10.3 lands, a find-replace swaps the import path; the
 * `EmptyStatePlaceholder` directory is then deleted in the same PR.
 *
 * Shape mirrors UX-DR16: icon slot + headline + optional action. Copy is
 * placeholder-only (`fixture.*` keys are intentionally NOT added to
 * en.json / vi.json so i18n parity stays clean — stories that need real
 * empty-state copy pass `headline` / `actionLabel` props with i18n-resolved
 * strings).
 */
export function EmptyStatePlaceholder({
  headline,
  body,
  actionLabel,
  onAction,
}: {
  headline?: string
  body?: string
  actionLabel?: string
  onAction?: () => void
}) {
  const { t } = useTranslation()
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-muted/40 px-6 py-10 text-center"
      data-testid="empty-state-placeholder"
    >
      <div
        aria-hidden
        className="size-12 rounded-full bg-muted"
        data-testid="empty-state-placeholder-icon"
      />
      <h3 className="font-heading text-lg text-foreground">
        {headline ?? t('app.name')}
      </h3>
      {body ? <p className="max-w-sm text-sm text-muted-foreground">{body}</p> : null}
      {actionLabel && onAction ? (
        <Button variant="outline" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}
