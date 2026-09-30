/**
 * PlanLimitExceededDialog — the latent 409 `PLAN_LIMIT_EXCEEDED` hard-block
 * (Story 9-1b, AC14 / C7 / C11 / D-9-1b-1). Enforcement is dark-launched OFF
 * (D19) so this fires only via MSW/synthetic `ApiError` in 9-1b tests; 9.2 arms
 * it. Reachable app-wide through the global `ApiError` seam.
 *
 * Copy is keyed on the error `code` (not the English server `message`). The 409
 * detail object is read through the `isPlanLimitDetails` runtime guard because
 * `ApiError.details` is `unknown` (D-9-1b-4). When the guard rejects the shape
 * (a malformed / unknown detail — a server contract slip), the dialog falls
 * through to a NEUTRAL generic message with no role branch — it never defaults to
 * the non-owner "ask your owner" copy, which would misinform an owner (P4).
 *
 * With a valid detail it names WHICH limit was hit (`details.limit` →
 * `billing.error.limitName.*`, AC14) + current/max, states that existing access
 * is not degraded (only the new action is blocked), and branches on
 * `details.canManageBilling`:
 *   - owner → a "See plans" link to the picker (NO "Upgrade" verb — the purchase
 *     flow is 9.2, a dead button would be a broken promise, D-9-1b-1);
 *   - non-owner → the shared "ask your center owner" copy, no CTA.
 */
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiError } from '@/lib/api-fetch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { isPlanLimitDetails } from '../lib/typeGuards'

const PLANS_PATH = '/settings/billing/plans'

export interface PlanLimitExceededDialogProps {
  open: boolean
  error: ApiError
  onClose?: () => void
}

export function PlanLimitExceededDialog({
  open,
  error,
  onClose,
}: PlanLimitExceededDialogProps): ReactElement {
  const { t } = useTranslation()
  const details = isPlanLimitDetails(error.details) ? error.details : null

  // P4: a malformed / unknown 409 detail falls through to a neutral generic
  // message — never the non-owner "ask your owner" path (which would misinform
  // an owner whose detail happened to be malformed).
  if (!details) {
    return (
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) onClose?.()
        }}
      >
        <DialogContent data-testid="plan-limit-exceeded-dialog">
          <DialogHeader>
            <DialogTitle>{t('billing.error.planLimitExceeded')}</DialogTitle>
            <DialogDescription>{t('billing.error.generic')}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  const { canManageBilling } = details
  const maxLabel = details.max === null ? t('billing.meter.unlimited') : details.max
  // AC14: name WHICH limit was hit; an unknown code falls back to a generic noun.
  const limitName = t(`billing.error.limitName.${details.limit}`, {
    defaultValue: t('billing.error.limitNameGeneric'),
  })

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose?.()
      }}
    >
      <DialogContent data-testid="plan-limit-exceeded-dialog">
        <DialogHeader>
          <DialogTitle>{t('billing.error.planLimitExceeded')}</DialogTitle>
          <DialogDescription>
            {t('billing.error.planLimitAccessKept')}
          </DialogDescription>
        </DialogHeader>

        <p className="text-sm font-medium text-slate-800">
          {t('billing.error.planLimitNamed', { name: limitName })}
        </p>
        <p className="text-sm text-slate-700 tabular-nums">
          {t('billing.error.planLimitUsage', {
            current: details.current,
            max: maxLabel,
          })}
        </p>

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
