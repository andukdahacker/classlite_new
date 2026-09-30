/**
 * Billing error-detail type-guards — Story 9-1b (AC16, D-9-1b-4).
 *
 * `ApiError.details` is typed `unknown` and the generated `ErrorBody.details`
 * schema (`oneOf: [null, FieldError[]]`) does NOT describe the billing 409/402
 * detail objects. We deliberately do NOT widen that shared schema (it buys
 * nothing at the use-site and risks `tsc -b` churn across every feature that
 * reads `details`). Instead these runtime guards are the SOLE source of truth
 * for the billing detail shapes — they narrow `unknown` and, critically,
 * DISCRIMINATE: each rejects the other error's object, a `FieldError[]`, and
 * `null`, so an unexpected shape falls through to a generic path rather than
 * rendering `undefined`.
 *
 * Shapes mirror `error_mapper.go` verbatim:
 *   409 PLAN_LIMIT_EXCEEDED → { limit, current, max, canManageBilling }
 *   402 INSUFFICIENT_CREDITS → { available, required }
 */

/** The 409 `PLAN_LIMIT_EXCEEDED` detail object. */
export interface PlanLimitDetails {
  limit: string
  current: number
  max: number | null
  canManageBilling: boolean
}

/** The 402 `INSUFFICIENT_CREDITS` detail object. */
export interface InsufficientCreditsDetails {
  available: number
  required: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** isPlanLimitDetails narrows `unknown` to the 409 detail object. */
export function isPlanLimitDetails(value: unknown): value is PlanLimitDetails {
  if (!isRecord(value)) return false
  return (
    typeof value.limit === 'string' &&
    typeof value.current === 'number' &&
    (typeof value.max === 'number' || value.max === null) &&
    typeof value.canManageBilling === 'boolean'
  )
}

/** isInsufficientCreditsDetails narrows `unknown` to the 402 detail object. */
export function isInsufficientCreditsDetails(
  value: unknown,
): value is InsufficientCreditsDetails {
  if (!isRecord(value)) return false
  return typeof value.available === 'number' && typeof value.required === 'number'
}
