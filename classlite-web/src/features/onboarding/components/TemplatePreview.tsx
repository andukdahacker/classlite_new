/**
 * TemplatePreview — Story 2-3b AC3 inline preview drawer.
 *
 * Appears below the template grid when a card is selected. Renders metadata
 * + a Continue CTA that (for a system/center template) advances the wizard
 * OR (for Build-from-scratch) still routes to /setup/spawn where the
 * blocked-variant CTA lives.
 */
import { useTranslation } from 'react-i18next'
import type { Template } from '../api/useListTemplates'

export interface TemplatePreviewProps {
  template: Template | null
  buildFromScratch: boolean
  onContinue: () => void
  pending: boolean
}

export function TemplatePreview({
  template,
  buildFromScratch,
  onContinue,
  pending,
}: TemplatePreviewProps) {
  const { t } = useTranslation()
  // R1-C2-P14 — return null when neither branch applies. Rendering an empty
  // <h3> is an accessibility smell (SRs may or may not skip empty headings)
  // and there's no meaningful preview to show without a template or the
  // Build-from-scratch tile.
  if (!buildFromScratch && !template) return null
  const title = buildFromScratch
    ? t('onboarding.template.buildFromScratch.title')
    : t('onboarding.template.preview.title', {
        templateName: template!.name,
      })
  return (
    <div
      data-testid="template-preview-drawer"
      className="mt-6 rounded-lg border border-slate-200 bg-white p-6"
      aria-busy={pending}
    >
      <h3 className="font-serif text-xl">{title}</h3>
      {buildFromScratch ? (
        <p className="mt-2 text-sm text-slate-600">
          {t('onboarding.template.buildFromScratch.description')}
        </p>
      ) : (
        <p className="mt-2 text-sm text-slate-600">
          {t('onboarding.template.preview.sessionsPreview')}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button
          type="button"
          disabled={pending}
          onClick={onContinue}
          aria-busy={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
        >
          {t('onboarding.template.continueCta')}
        </button>
      </div>
    </div>
  )
}
