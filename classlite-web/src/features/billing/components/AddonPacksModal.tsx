/**
 * AddonPacksModal — buy AI-credit add-on packs (Story 9-2b, AC7/8/9/10/13/17/18).
 *
 * Renders each `BillingAddonOffer` as a pack card (credits, total price, explicit
 * VAT breakout: subtotal + VAT 10% = total) from `GET /api/billing/addons`, all via
 * `formatVnd` (server VND, never recomputed). Selecting a pack starts a Polar
 * checkout (`kind: "addon"`) and redirects; credits are granted webhook-side.
 *
 * Branches (all i18n, UX-1):
 *   - Free tier (`eligible === false`, from a 403 ADDON_NOT_AVAILABLE) → an upgrade
 *     prompt instead of purchasable packs (AC9) — eligibility, never a 402.
 *   - A scheduled downgrade-to-Free → a hard, dismissible warning that the credits
 *     will pause on Free BEFORE proceeding (AC10) — FE-side only, no backend block.
 *   - Desktop-only (AC18): mobile shows an honest "open on desktop" hint.
 *   - loading skeleton / empty / inline-retry error over the addons query.
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useIsDesktop } from '@/hooks/useMediaQuery'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useBillingSummary } from '../api/useBillingSummary'
import { useBillingAddons, type BillingAddonOffer } from '../api/useBillingAddons'
import { useCreateCheckout } from '../api/useCreateCheckout'
import { formatVnd } from '../lib/formatVnd'
import { normalizeSummaryPending } from '../lib/pendingDowngrade'

const PLANS_PATH = '/settings/billing/plans'

export interface AddonPacksModalProps {
  open: boolean
  onClose: () => void
}

export function AddonPacksModal({
  open,
  onClose,
}: AddonPacksModalProps): ReactElement {
  const { t } = useTranslation()
  const isDesktop = useIsDesktop()
  const summaryQuery = useBillingSummary()
  const addonsQuery = useBillingAddons(open && isDesktop)
  const checkout = useCreateCheckout()
  // A pack held pending the downgrade-to-Free warning acknowledgement (AC10).
  const [warnPack, setWarnPack] = useState<BillingAddonOffer | null>(null)

  const close = (next: boolean): void => {
    if (!next) onClose()
  }

  const pendingDowngrade = normalizeSummaryPending(
    summaryQuery.data?.pendingDowngrade ?? null,
  )
  const downgradingToFree = pendingDowngrade?.plan === 'free'

  const purchase = (pack: BillingAddonOffer): void => {
    checkout.mutate({
      kind: 'addon',
      addonPackId: pack.packId,
      plan: null,
      billingCycle: null,
    })
  }

  const onBuy = (pack: BillingAddonOffer): void => {
    // AC10: warn before buying if a downgrade-to-Free is scheduled.
    if (downgradingToFree) {
      setWarnPack(pack)
      return
    }
    purchase(pack)
  }

  if (!isDesktop) {
    return (
      <Dialog open={open} onOpenChange={close}>
        <DialogContent data-testid="addon-packs-mobile-hint">
          <DialogHeader>
            <DialogTitle>{t('billing.addons.mobileHintTitle')}</DialogTitle>
            <DialogDescription>{t('billing.addons.mobileHint')}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    )
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="sm:max-w-lg" data-testid="addon-packs-modal">
        <DialogHeader>
          <DialogTitle>{t('billing.addons.title')}</DialogTitle>
          <DialogDescription>{t('billing.addons.subtitle')}</DialogDescription>
        </DialogHeader>

        {addonsQuery.isPending ? (
          <div className="space-y-2" data-testid="addon-packs-skeleton" role="status" aria-busy="true">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : addonsQuery.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between rounded-md border border-[color:var(--cl-red)] bg-[color:var(--cl-tint-red)] px-4 py-3 text-sm text-[color:var(--cl-red)]"
            data-testid="addon-packs-error"
          >
            <span>{t('billing.addons.loadError')}</span>
            <Button size="sm" variant="outline" onClick={() => addonsQuery.refetch()}>
              {t('billing.error.retry')}
            </Button>
          </div>
        ) : !addonsQuery.data.eligible ? (
          <div className="flex flex-col gap-2 rounded-lg border border-dashed border-slate-300 p-4" data-testid="addon-packs-free-prompt">
            <p className="text-sm font-medium text-slate-800">{t('billing.addons.freeTitle')}</p>
            <p className="text-sm text-slate-600">{t('billing.addons.freeBody')}</p>
            <a
              href={PLANS_PATH}
              className="inline-flex w-fit items-center rounded-md bg-[color:var(--cl-accent)] px-3 py-1.5 text-sm font-medium text-white"
            >
              {t('billing.addons.freeCta')}
            </a>
          </div>
        ) : addonsQuery.data.addons.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-300 p-4 text-sm text-slate-500" data-testid="addon-packs-empty">
            {t('billing.addons.empty')}
          </p>
        ) : warnPack ? (
          <div className="flex flex-col gap-2 rounded-lg border border-[color:var(--cl-amber)] bg-[color:var(--cl-tint-gold)] p-4" data-testid="addon-downgrade-warn">
            <p className="text-sm font-medium text-slate-800">{t('billing.addons.downgradeWarnTitle')}</p>
            <p className="text-sm text-slate-700">{t('billing.addons.downgradeWarnBody')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setWarnPack(null)} disabled={checkout.isPending}>
                {t('billing.addons.downgradeWarnCancel')}
              </Button>
              <Button
                size="sm"
                data-testid="addon-downgrade-warn-proceed"
                onClick={() => purchase(warnPack)}
                disabled={checkout.isPending}
              >
                {t('billing.addons.downgradeWarnProceed')}
              </Button>
            </div>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {addonsQuery.data.addons.map((pack) => (
              <li
                key={pack.packId}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 p-3"
                data-testid={`addon-pack-${pack.packId}`}
              >
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {t('billing.addons.packCredits', { credits: pack.credits })}
                  </p>
                  <p className="text-lg font-semibold tabular-nums text-slate-900">
                    {formatVnd(pack.priceVnd)}
                  </p>
                  <p className="text-xs text-slate-500 tabular-nums">
                    {t('billing.picker.vatSplit', {
                      subtotal: formatVnd(pack.subtotalVnd),
                      vat: formatVnd(pack.vatVnd),
                    })}
                  </p>
                </div>
                <Button
                  size="sm"
                  data-testid={`addon-pack-buy-${pack.packId}`}
                  onClick={() => onBuy(pack)}
                  // AC10: block the buy until the summary resolves, so the
                  // downgrade-to-Free warning can never be silently skipped on a
                  // cold/errored summary (an undefined `pendingDowngrade` → false).
                  disabled={checkout.isPending || !summaryQuery.isSuccess}
                >
                  {t('billing.addons.buy')}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {checkout.isError ? (
          <p
            role="alert"
            className="rounded-md bg-[color:var(--cl-tint-red)] px-3 py-2 text-sm text-[color:var(--cl-red)]"
            data-testid="addon-packs-checkout-error"
          >
            {/* A checkout 403 ADDON_NOT_AVAILABLE means the tier changed between the
                addons load and the buy — point the owner at the plans page; any other
                checkout failure gets the generic retry copy. */}
            {checkout.error?.code === 'ADDON_NOT_AVAILABLE'
              ? t('billing.addons.freeBody')
              : t('billing.addons.checkoutError')}
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
