/**
 * useAiCredits — Story 4.3b (AC1/AC6) display-only AI-credit counter seam.
 *
 * The dialog shows "N of 50 monthly AI credits used" before confirm. Story 4.3a
 * minted the `ai_credit_ledger` but exposes NO balance-read endpoint — the live
 * balance, the reconciled `used` figure, the 402 hard-limit block, and the
 * Settings→Credits UI are all Story 6.5. Until 6.5 lands, this hook is the SINGLE
 * seam that 6.5 replaces with the real read: it returns the plan allowance as the
 * denominator and a placeholder `used` of 0 (the counter is explicitly
 * display-only per the story — never a client-side gate). See FU-4-3-B.
 */
import { MONTHLY_AI_CREDIT_ALLOWANCE } from '../lib/aiGeneration'

export interface AiCredits {
  used: number
  total: number
}

export function useAiCredits(): AiCredits {
  // TODO(amelia): GH-6.5 — replace with the live balance read (GET credits).
  return { used: 0, total: MONTHLY_AI_CREDIT_ALLOWANCE }
}
