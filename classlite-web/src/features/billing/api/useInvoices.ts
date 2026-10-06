/**
 * useInvoices — the s70 invoice-history read (Story 9.3, AC14). `GET /api/billing/invoices`
 * returns the center's invoices newest-first; apiFetch unwraps the `{data, meta}` envelope so
 * the hook yields the `BillingInvoice[]` array directly (pagination meta is not consumed in v1
 * — the full history fits one page at pageSize 100). Owner-only surface (the route gate).
 *
 * `status` is an OPTIONAL pill filter ('' = all). Keyed on it (TS-3) so each filter caches
 * independently. Amounts/VAT render verbatim from the server snapshot (D25) — never recomputed.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type BillingInvoice = components['schemas']['BillingInvoice']

const INVOICES_STALE_TIME_MS = 30_000
/** The page cap the FE requests; exported so the page can surface an honest "showing N" note
 *  instead of silently truncating when exactly this many rows return (code-review D7). */
export const INVOICES_PAGE_SIZE = 100

/** useInvoices fetches `GET /api/billing/invoices?status=` → `BillingInvoice[]`. */
export function useInvoices(status = '') {
  return useQuery<BillingInvoice[], ApiError>({
    queryKey: billingKeys.invoices(status),
    queryFn: () => {
      const params = new URLSearchParams({ page: '1', pageSize: String(INVOICES_PAGE_SIZE) })
      if (status) params.set('status', status)
      return apiFetch<BillingInvoice[]>(`/api/billing/invoices?${params.toString()}`)
    },
    staleTime: INVOICES_STALE_TIME_MS,
  })
}
