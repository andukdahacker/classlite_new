/**
 * ReopenChecklistCta — Story 2-5a AC5/AC6.
 *
 * Gated render: ONLY appears when `useChecklistState(userId).state.snoozedUntil`
 * is non-null (Amelia-S12 + John ACCEPT fold — prevents user-hostile "why
 * is this button here" UX for Owners who never snoozed).
 *
 * Click flow:
 *   1. useChecklistState.clearSnooze() removes the localStorage key.
 *   2. Fire `checklist-reopened-from-settings` Sentry breadcrumb (distinct
 *      from the hook's own `checklist-reopened` — this one carries the
 *      surface for forensics).
 *   3. Toast (Sonner) with fixed id `settings-reopen-checklist` — queue-of-one.
 *   4. NO navigation — user stays on Settings.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { addBreadcrumb } from '@sentry/react'
import { useChecklistState } from '@/features/dashboard/hooks/useChecklistState'

export interface ReopenChecklistCtaProps {
  userId: string | null
}

const TOAST_ID = 'settings-reopen-checklist'

export function ReopenChecklistCta({
  userId,
}: ReopenChecklistCtaProps): ReactElement | null {
  const { t } = useTranslation()
  const { state, clearSnooze } = useChecklistState(userId)

  if (state.snoozedUntil === null) return null

  const handleClick = (): void => {
    clearSnooze()
    addBreadcrumb({
      category: 'checklist',
      message: 'checklist-reopened-from-settings',
      level: 'info',
      data: { userId },
    })
    toast(t('settings.profile.reopenChecklist.toast'), { id: TOAST_ID })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      data-testid="settings-reopen-checklist-cta"
      className="text-sm font-medium text-blue-700 underline underline-offset-2 hover:text-blue-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
    >
      {t('settings.profile.reopenChecklistCta')}
    </button>
  )
}
