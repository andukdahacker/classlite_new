/**
 * BuildFromScratchTile — Story 2-3b AC1 last-tile variant.
 *
 * Special dashed-border variant of a template card. Selecting it drives the
 * spawn page into the Build-from-scratch-blocked variant (Sally-B2 fold).
 */
import { useTranslation } from 'react-i18next'

export interface BuildFromScratchTileProps {
  selected: boolean
}

export function BuildFromScratchTile({ selected }: BuildFromScratchTileProps) {
  const { t } = useTranslation()
  return (
    <div
      className={
        'flex h-full cursor-pointer flex-col gap-3 rounded-lg border-2 border-dashed p-5 transition-colors ' +
        (selected
          ? 'border-slate-900 bg-white shadow-sm'
          : 'border-slate-300 bg-slate-50 hover:border-slate-400')
      }
    >
      <h3 className="font-serif text-lg leading-tight">
        {t('onboarding.template.buildFromScratch.title')}
      </h3>
      <p className="text-sm text-slate-600">
        {t('onboarding.template.buildFromScratch.description')}
      </p>
    </div>
  )
}
