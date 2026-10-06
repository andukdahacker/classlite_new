/**
 * useGrace — the s73 grace-strip source (Story 9.3, R4). `GET /api/billing/grace` returns just
 * the grace block (or null when not past_due); readable by owner AND admin (R4 — a scoped read
 * so admin gets the indicator without the owner-only full summary). apiFetch unwraps the
 * envelope so the hook yields `BillingGrace | null`.
 *
 * The caller gates the query with `enabled` to owner|admin only (teacher/student must never
 * fetch billing state — TEST-FE-6). `staleTime` is short: once in grace the countdown advances,
 * and a recovery should clear the strip promptly on the next poll.
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type BillingGrace = components['schemas']['BillingGrace']

const GRACE_STALE_TIME_MS = 30_000

/** useGrace fetches `GET /api/billing/grace` → `BillingGrace | null`. Gated by `enabled`. */
export function useGrace(enabled: boolean) {
  return useQuery<BillingGrace | null, ApiError>({
    queryKey: billingKeys.grace(),
    queryFn: () => apiFetch<BillingGrace | null>('/api/billing/grace'),
    staleTime: GRACE_STALE_TIME_MS,
    enabled,
  })
}
