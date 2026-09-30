/**
 * InsufficientCreditsDialog — the latent 402 `INSUFFICIENT_CREDITS` gate
 * (Story 9-1b, AC15 / C8 / D-9-1b-1). Dark-launched OFF (D19) — MSW/synthetic
 * `ApiError` only in 9-1b; 9.2 arms it. Reachable via the global `ApiError`
 * seam.
 *
 * Copy is keyed on the error `code`. The 402 detail object is read through the
 * `isInsufficientCreditsDetails` runtime guard (`ApiError.details` is `unknown`,
 * D-9-1b-4): it names the gap (available vs required). Unlike the 409 detail, the
 * 402 detail carries NO `canManageBilling` flag, so the actor's authority is read
 * from `useRole()` (billing is owner-only, D9): the owner gets a "See plans" link
 * (NO "Upgrade" verb — purchase is 9.2, D-9-1b-1); a non-owner (AI grading is a
 * teacher action) gets the shared "ask your owner" copy and NO CTA — never a link
 * to the owner-only picker that would dead-end at PermissionDenied.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiError } from '@/lib/api-fetch'
import { useRole } from '@/hooks/useRole'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isInsufficientCreditsDetails } from '../lib/typeGuards'

const PLANS_PATH = '/settings/billing/plans'

export interface InsufficientCreditsDialogProps {
  open: boolean
  error: ApiError
  onClose?: () => void
}

export function InsufficientCreditsDialog({
  open,
  error,
  onClose,
}: InsufficientCreditsDialogProps): ReactElement {
  const { t } = useTranslation()
  const role = useRole()
  const canManageBilling = role === 'owner'
  const details = isInsufficientCreditsDetails(error.details) ? error.details : null

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.()
      }}
    >
      <DialogContent data-testid="insufficient-credits-dialog">
        <DialogHeader>
          <DialogTitle>{t('billing.error.insufficientCredits')}</DialogTitle>
          <DialogDescription>
            {t('billing.error.insufficientCreditsHint')}
          </DialogDescription>
        </DialogHeader>

        {details ? (
          <p className="text-sm text-slate-700 tabular-nums">
            {t('billing.error.insufficientCreditsBody', {
              available: details.available,
              required: details.required,
            })}
          </p>
        ) : null}

        {canManageBilling ? (
          <a
            href={PLANS_PATH}
            className="inline-flex w-fit items-center rounded-md bg-[color:var(--cl-accent)] px-3 py-1.5 text-sm font-medium text-white"
          >
            {t('billing.dashboard.seePlans')}
          </a>
        ) : (
          <p className="text-sm text-slate-600">{t('billing.error.askOwner')}</p>
        )}
      </DialogContent>
    </Dialog>
  )
}
