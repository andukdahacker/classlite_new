// Story 9-2b — Task 1 data layer. Locks the non-obvious hook behaviors against MSW
// (the one mock seam, TEST-FE-1): checkout redirects to the Polar URL, the add-on
// 403 ADDON_NOT_AVAILABLE is folded to `eligible: false` (NOT the error trilogy),
// and the downgrade schedule/cancel mutations write optimistically then invalidate.
import type { ReactElement, ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import type { components } from '@/lib/api/client'
import { server } from '@/test/msw-server'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { billingKeys } from '../api/billingKeys'
import { useBillingAddons } from '../api/useBillingAddons'
import { useCreateCheckout } from '../api/useCreateCheckout'
import {
  useScheduleDowngrade,
  useCancelDowngrade,
} from '../api/useScheduleDowngrade'
import type { BillingSummary } from '../api/useBillingSummary'

type BillingAddonOffer = components['schemas']['BillingAddonOffer']

const ADDONS: BillingAddonOffer[] = [
  { packId: 'credits_100', credits: 100, priceVnd: 99000, subtotalVnd: 90000, vatVnd: 9000 },
]

function makeSummary(pending: BillingSummary['pendingDowngrade']): BillingSummary {
  return {
    plan: 'pro',
    billingCycle: 'monthly',
    status: 'active',
    isFree: false,
    creditsApplicable: true,
    currentPeriodStart: '2026-09-01T00:00:00+07:00',
    currentPeriodEnd: '2026-10-01T00:00:00+07:00',
    limits: { teachers: 10, classes: null, studentsPerClass: 20, aiCreditsPerMonth: 500, storageBytes: 5368709120 },
    usage: {
      teacherSeats: { current: 3, max: 10, approaching: false },
      classes: { current: 4, max: null, approaching: false },
      aiCredits: { monthlyAllocation: 500, monthlyUsed: 100, addonRemaining: 0, available: 400, resetAt: '2026-10-01T00:00:00+07:00' },
      storage: { usedBytes: 1, limitBytes: 5368709120, percentUsed: 0, approaching: false },
    },
    nextInvoice: null,
    paymentMethod: null,
    pendingDowngrade: pending,
  }
}

function makeClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
}

function wrapperFor(client: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }): ReactElement {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

let location: StubbedLocation

beforeEach(() => {
  location = stubLocation()
})
afterEach(() => {
  location.restore()
})

describe('useCreateCheckout', () => {
  test('redirects the browser to the returned Polar checkoutUrl', async () => {
    server.use(
      http.post('*/api/billing/checkout', () =>
        HttpResponse.json({ data: { checkoutUrl: 'https://polar.sh/checkout/abc' }, meta: { requestId: 't' } }),
      ),
    )
    const { result } = renderHook(() => useCreateCheckout(), { wrapper: wrapperFor(makeClient()) })
    result.current.mutate({ kind: 'upgrade', plan: 'studio', billingCycle: 'monthly', addonPackId: null })
    await waitFor(() => expect(location.assign).toHaveBeenCalledWith('https://polar.sh/checkout/abc'))
  })
})

describe('useBillingAddons', () => {
  test('resolves eligible:true with the packs on success', async () => {
    server.use(
      http.get('*/api/billing/addons', () =>
        HttpResponse.json({ data: { addons: ADDONS }, meta: { requestId: 't' } }),
      ),
    )
    const { result } = renderHook(() => useBillingAddons(), { wrapper: wrapperFor(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data?.eligible).toBe(true)
    expect(result.current.data?.addons).toHaveLength(1)
  })

  test('folds a 403 ADDON_NOT_AVAILABLE into eligible:false (not an error)', async () => {
    server.use(
      http.get('*/api/billing/addons', () =>
        HttpResponse.json(
          { error: { code: 'ADDON_NOT_AVAILABLE', message: 'Free tier', requestId: 't' } },
          { status: 403 },
        ),
      ),
    )
    const { result } = renderHook(() => useBillingAddons(), { wrapper: wrapperFor(makeClient()) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.isError).toBe(false)
    expect(result.current.data?.eligible).toBe(false)
    expect(result.current.data?.addons).toHaveLength(0)
  })

  test('rethrows a non-eligibility error into the error state', async () => {
    server.use(
      http.get('*/api/billing/addons', () =>
        HttpResponse.json(
          { error: { code: 'INTERNAL', message: 'boom', requestId: 't' } },
          { status: 500 },
        ),
      ),
    )
    const { result } = renderHook(() => useBillingAddons(), { wrapper: wrapperFor(makeClient()) })
    await waitFor(() => expect(result.current.isError).toBe(true))
  })
})

describe('useScheduleDowngrade / useCancelDowngrade (optimistic triple)', () => {
  test('schedule optimistically writes pendingDowngrade onto the summary cache', async () => {
    const client = makeClient()
    client.setQueryData(billingKeys.summary(), makeSummary(null))
    server.use(
      http.post('*/api/billing/downgrade', async () => {
        // Hold so the optimistic write is observable before settle.
        return HttpResponse.json({
          data: { pendingPlan: 'free', pendingBillingCycle: 'monthly', effectiveAt: '2026-10-01T00:00:00+07:00' },
          meta: { requestId: 't' },
        })
      }),
      http.get('*/api/billing', () => HttpResponse.json({ data: makeSummary({ plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' }), meta: { requestId: 't' } })),
    )
    const { result } = renderHook(() => useScheduleDowngrade(), { wrapper: wrapperFor(client) })
    result.current.mutate({ plan: 'free', billingCycle: 'monthly' })
    await waitFor(() => {
      const cached = client.getQueryData<BillingSummary>(billingKeys.summary())
      expect(cached?.pendingDowngrade).toEqual({ plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' })
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })

  test('schedule rolls back the optimistic write on error', async () => {
    const client = makeClient()
    client.setQueryData(billingKeys.summary(), makeSummary(null))
    server.use(
      http.post('*/api/billing/downgrade', () =>
        HttpResponse.json({ error: { code: 'VALIDATION_ERROR', message: 'not lower', requestId: 't' } }, { status: 422 }),
      ),
      http.get('*/api/billing', () => HttpResponse.json({ data: makeSummary(null), meta: { requestId: 't' } })),
    )
    const { result } = renderHook(() => useScheduleDowngrade(), { wrapper: wrapperFor(client) })
    result.current.mutate({ plan: 'free', billingCycle: 'monthly' })
    await waitFor(() => expect(result.current.isError).toBe(true))
    const cached = client.getQueryData<BillingSummary>(billingKeys.summary())
    expect(cached?.pendingDowngrade).toBeNull()
  })

  test('cancel optimistically clears pendingDowngrade', async () => {
    const client = makeClient()
    client.setQueryData(billingKeys.summary(), makeSummary({ plan: 'free', effectiveAt: '2026-10-01T00:00:00+07:00' }))
    server.use(
      http.post('*/api/billing/downgrade/cancel', () =>
        HttpResponse.json({ data: { pendingPlan: '', pendingBillingCycle: '', effectiveAt: '' }, meta: { requestId: 't' } }),
      ),
      http.get('*/api/billing', () => HttpResponse.json({ data: makeSummary(null), meta: { requestId: 't' } })),
    )
    const { result } = renderHook(() => useCancelDowngrade(), { wrapper: wrapperFor(client) })
    result.current.mutate()
    await waitFor(() => {
      const cached = client.getQueryData<BillingSummary>(billingKeys.summary())
      expect(cached?.pendingDowngrade).toBeNull()
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})
