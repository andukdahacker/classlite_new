/**
 * useBillingSummary — the caller's current plan + limits + live usage
 * (Story 9-1b, AC17). Owner-only surface; the server owns every derived flag
 * (`approaching`, `isFree`, `creditsApplicable`, `resetAt`) per D22/D24 — the FE
 * renders them verbatim and re-derives nothing (mirrors `LoadMeter`'s
 * server-owned `heavy`).
 *
 * `staleTime` is a middle value (~45s): usage drifts as seats/classes/credits
 * change but not fast enough to justify the 30s project default's churn on a
 * settings surface (FW-3 — explicit, justified).
 */
import { useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch, type ApiError } from '@/lib/api-fetch'
import { billingKeys } from './billingKeys'

export type BillingSummary = components['schemas']['BillingSummary']

const SUMMARY_STALE_TIME_MS = 45_000

/**
 * useBillingSummary fetches `GET /api/billing` → `BillingSummary`.
 *
 * `enabled` (default `true`) gates the fetch. `/api/billing` is owner-only (403 for
 * admin/teacher/student), so a caller rendered for mixed roles — e.g. the app-wide
 * PlanLimitExceededDialog — passes `canManageBilling` to avoid firing a
 * guaranteed-403 request for non-owners.
 */
export function useBillingSummary(enabled = true) {
  return useQuery<BillingSummary, ApiError>({
    queryKey: billingKeys.summary(),
    queryFn: () => apiFetch<BillingSummary>('/api/billing'),
    staleTime: SUMMARY_STALE_TIME_MS,
    enabled,
  })
}
