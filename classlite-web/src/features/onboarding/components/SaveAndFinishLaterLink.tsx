/**
 * SaveAndFinishLaterLink — Story 2-3c AC4 shared button used by all 3
 * wizard steps that ship the "Save and finish later" affordance. Round 1
 * code-review folds (R1-C2-P1 + P2 + P3) live inside the underlying hook:
 * double-click prevention, flush-failure Sentry breadcrumb, guaranteed
 * navigate on either path.
 *
 * Callsites pass their primary mutation's pending flag so the button is
 * disabled during in-flight form submits (concurrent-mutation guard).
 * `tone` selects the text color for the amber-card variant on
 * `ClassSpawnPage` buildFromScratch (default = slate on white surfaces).
 */
import { useTranslation } from 'react-i18next'
import { useSaveAndFinishLater } from '../hooks/useSaveAndFinishLater'

interface SaveAndFinishLaterLinkProps {
  page: string
  flush: () => Promise<void>
  primaryPending: boolean
  /**
   * Visual variant. Defaults to `'slate'` (`text-slate-500` on white
   * surfaces). Use `'amber'` for the ClassSpawnPage buildFromScratch
   * amber-card placement — R1-C2-P5 swapped `text-amber-800` for
   * `text-slate-700` to meet WCAG AA contrast on the amber-50/100 fill.
   */
  tone?: 'slate' | 'amber'
  /**
   * Layout mode. `'right'` (default) wraps the button in a flex-end row —
   * used on the 3 white-surface footers. `'inline'` renders no wrapper —
   * callsites (or the amber-card variant) own the layout wrapper.
   */
  layout?: 'right' | 'inline'
}

const TONE_CLASS: Record<NonNullable<SaveAndFinishLaterLinkProps['tone']>, string> = {
  slate: 'text-slate-500',
  // R1-C2-P5: `text-slate-700` on amber-50/100 background meets WCAG 1.4.3 AA
  // (contrast ratio > 4.5:1 vs. previously-shipped `text-amber-800` which was
  // borderline at the text-xs size).
  amber: 'text-slate-700',
}

export function SaveAndFinishLaterLink({
  page,
  flush,
  primaryPending,
  tone = 'slate',
  layout = 'right',
}: SaveAndFinishLaterLinkProps) {
  const { t } = useTranslation()
  const { leaving, trigger } = useSaveAndFinishLater({ flush, page })

  const button = (
    <button
      type="button"
      disabled={leaving || primaryPending}
      className={`text-xs ${TONE_CLASS[tone]} underline disabled:cursor-not-allowed disabled:opacity-50`}
      onClick={trigger}
    >
      {t('onboarding.wizard.saveAndFinishLater')}
    </button>
  )

  if (layout === 'inline') return button
  return <div className="mt-3 flex justify-end">{button}</div>
}
