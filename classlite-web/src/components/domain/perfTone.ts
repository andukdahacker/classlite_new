/**
 * PerfTone — the student performance-pill tone (Story 7.2b D8). Lives beside
 * `PerfPill` but in its own module so the component file stays
 * component-only (react-refresh) and so the AtRiskStatus → tone mapper is
 * importable without pulling the component. Sources the wire enum from the
 * generated client (NOT a feature) to honor the FW-7 domain-tier boundary.
 */
import type { components } from '@/lib/api/client'

type AtRiskStatus = components['schemas']['AtRiskStatus']

/** The testid tone segment matches the ATDD seams: `perf-pill-{tone}`. */
export type PerfTone = 'good' | 'normal' | 'at-risk' | 'unassigned'

/**
 * Maps the wire `AtRiskStatus` to the pill tone. `unassigned` is NOT an
 * at-risk status — the caller passes it explicitly when
 * `activeEnrollmentCount === 0` (s42, D12); this helper only covers the three
 * performance states the backend emits.
 */
export function perfToneFromStatus(status: AtRiskStatus): PerfTone {
  return status === 'at_risk' ? 'at-risk' : status
}
