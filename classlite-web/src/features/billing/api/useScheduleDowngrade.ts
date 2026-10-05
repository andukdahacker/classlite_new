/**
 * useScheduleDowngrade / useCancelDowngrade — schedule or cancel an at-renewal
 * plan downgrade (Story 9-2b, AC5/AC6). `POST /api/billing/downgrade` schedules it;
 * `POST /api/billing/downgrade/cancel` clears it. Both return the flat
 * `{ pendingPlan, pendingBillingCycle, effectiveAt }` shape (empty-string-when-none
 * — normalized elsewhere, see `lib/pendingDowngrade.ts`).
 *
 * The scheduled downgrade is the ONE checkout-adjacent state worth an optimistic
 * write (FW-2 triple): unlike upgrades/add-ons (webhook-confirmed, never trusted
 * client-side), downgrade scheduling is a direct server mutation whose effect
 * (`BillingSummary.pendingDowngrade`) the dashboard shows immediately. `onSettled`
 * invalidates `billingKeys.summary()` so the authoritative effectiveAt replaces the
 * optimistic estimate.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'
import type { BillingSummary } from './useBillingSummary'

export type BillingDowngradeRequest =
  components['schemas']['BillingDowngradeRequest']
type PendingDowngradeResult =
  components['schemas']['EnvelopeBillingPendingDowngrade']['data']

const JSON_HEADERS = { 'Content-Type': 'application/json' } as const

interface DowngradeMutationContext {
  previous: BillingSummary | undefined
}

/** useScheduleDowngrade schedules an at-renewal downgrade with an optimistic pending write. */
export function useScheduleDowngrade() {
  const queryClient = useQueryClient()
  return useMutation<
    PendingDowngradeResult,
    ApiError,
    BillingDowngradeRequest,
    DowngradeMutationContext
  >({
    mutationKey: billingKeys.downgradeMutation(),
    mutationFn: (body) =>
      apiFetch<PendingDowngradeResult>('/api/billing/downgrade', {
        method: 'POST',
        headers: JSON_HEADERS,
        body: JSON.stringify(body),
      }),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: billingKeys.summary() })
      const previous = queryClient.getQueryData<BillingSummary>(
        billingKeys.summary(),
      )
      // Optimistically show the scheduled downgrade. effectiveAt is the current
      // period boundary; the real value lands on the onSettled invalidate.
      if (previous && previous.currentPeriodEnd) {
        queryClient.setQueryData<BillingSummary>(billingKeys.summary(), {
          ...previous,
          pendingDowngrade: {
            plan: body.plan,
            effectiveAt: previous.currentPeriodEnd,
          },
        })
      }
      return { previous }
    },
    onError: (_error, _body, context) => {
      if (context?.previous) {
        queryClient.setQueryData(billingKeys.summary(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.summary() })
    },
  })
}

/** useCancelDowngrade clears a scheduled downgrade with an optimistic null write. */
export function useCancelDowngrade() {
  const queryClient = useQueryClient()
  return useMutation<
    PendingDowngradeResult,
    ApiError,
    void,
    DowngradeMutationContext
  >({
    mutationKey: billingKeys.cancelDowngradeMutation(),
    mutationFn: () =>
      apiFetch<PendingDowngradeResult>('/api/billing/downgrade/cancel', {
        method: 'POST',
      }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: billingKeys.summary() })
      const previous = queryClient.getQueryData<BillingSummary>(
        billingKeys.summary(),
      )
      if (previous) {
        queryClient.setQueryData<BillingSummary>(billingKeys.summary(), {
          ...previous,
          pendingDowngrade: null,
        })
      }
      return { previous }
    },
    onError: (_error, _void, context) => {
      if (context?.previous) {
        queryClient.setQueryData(billingKeys.summary(), context.previous)
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: billingKeys.summary() })
    },
  })
}
