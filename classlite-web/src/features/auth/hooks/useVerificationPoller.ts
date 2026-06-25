/**
 * useVerificationPoller — Story 1-9a AC3 + AC5.
 *
 * Feature-local wrapper around `usePolling` (the generic 5-second
 * ticking primitive from 1-7c) that adds:
 *   - API call shape (`apiFetch` URL construction + envelope unwrapping
 *     via the generic `<VerifyStatusResult>` parameter).
 *   - Response branching (verified / 404 POLL_ID_NOT_FOUND / other).
 *   - A `terminalStateRef` that drops late 200/404 responses arriving
 *     after a terminal commit (10-min cap fired, verified-true already
 *     committed, parallel 404 already committed). `usePolling`
 *     `clearInterval`s when `enabled=false` but does NOT abort
 *     in-flight fetches — the race resolution is owned here.
 *
 * Party-mode 2026-06-25 addition: the ref pattern means the
 * "first commit wins" contract is explicit and testable. Late-arriving
 * responses after a terminal commit are dropped silently (no Sentry
 * breadcrumb — this is expected, not exceptional).
 *
 * Caller owns the 10-min cap state (page-level useEffect timer) and
 * flips `enabled=false` when the cap fires; that same flip also calls
 * `commitTerminal('timeout')` to seal the race.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePolling } from '@/hooks/usePolling'
import { apiFetch, ApiError } from '@/lib/api-fetch'
import type { components } from '@/lib/api/client'

type VerifyStatusResult = components['schemas']['VerifyStatusResult']

export type TerminalState = 'verified' | 'expired' | 'timeout'
type RefState = 'pending' | TerminalState

export const VERIFICATION_POLL_INTERVAL_MS = 5_000

export interface UseVerificationPollerOpts {
  pollId: string
  enabled: boolean
}

export interface UseVerificationPollerResult {
  isPolling: boolean
  lastResponse: VerifyStatusResult | null
  lastError: ApiError | null
  /**
   * Synchronously seal the terminal state from non-poll sources
   * (10-min cap, click-through 200, manual recheck). Subsequent in-flight
   * polls that resolve after this call are dropped silently.
   */
  commitTerminal: (state: TerminalState) => void
  /**
   * Story 1-9a AC5 — manual recheck. Fires a SINGLE GET against the
   * verify-status endpoint, regardless of the `enabled` flag. Does NOT
   * re-arm the interval. The response branches the same way as a polled
   * response (verified-true → terminalStateRef = 'verified'; 404 →
   * terminalStateRef = 'expired'). If the page already committed a
   * terminal state via `commitTerminal`, this one-shot call resets the
   * ref to 'pending' BEFORE firing so the recheck can advance state.
   */
  rerunOnce: () => Promise<void>
}

export function useVerificationPoller({
  pollId,
  enabled,
}: UseVerificationPollerOpts): UseVerificationPollerResult {
  const [lastResponse, setLastResponse] = useState<VerifyStatusResult | null>(
    null,
  )
  const [lastError, setLastError] = useState<ApiError | null>(null)
  const terminalStateRef = useRef<RefState>('pending')

  // Reset terminal state + last-response/error when the pollId changes
  // (resend success path: page issues a fresh pollId via setSearchParams).
  // Without this, a prior 'timeout' or 'expired' commit persists across
  // re-arms and silently drops every subsequent poll. The ref reset is
  // synchronous-on-render so the next `fn` call (which already re-keys
  // on pollId) reads 'pending' from the very first tick.
  //
  // set-state-in-effect is justified: pollId IS the external input;
  // resetting `lastResponse`/`lastError` is the only way the consumer
  // (PollingView) re-derives `verified`/`expired` to false on the same
  // render as the new pollId — without these writes, the consumer
  // would see stale verified=true/expired=true for the new pollId and
  // never advance.
  useEffect(() => {
    terminalStateRef.current = 'pending'
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLastResponse(null)
    setLastError(null)
  }, [pollId])

  const commitTerminal = useCallback((state: TerminalState) => {
    if (terminalStateRef.current === 'pending') {
      terminalStateRef.current = state
    }
  }, [])

  const fn = useCallback(async () => {
    try {
      const result = await apiFetch<VerifyStatusResult>(
        `/api/auth/verify-status?pollId=${encodeURIComponent(pollId)}`,
      )
      // Drop late responses after a terminal commit. This includes both
      // success (verified: true / false) and 404 errors handled below —
      // a poll initiated before the cap fires can resolve after.
      if (terminalStateRef.current !== 'pending') return
      setLastResponse(result)
      if (result.verified) {
        terminalStateRef.current = 'verified'
      }
    } catch (err) {
      if (terminalStateRef.current !== 'pending') return
      if (err instanceof ApiError) {
        setLastError(err)
        if (err.status === 404 && err.code === 'POLL_ID_NOT_FOUND') {
          terminalStateRef.current = 'expired'
        }
        // 5xx — keep the poller running so the next tick retries; the
        // ApiError already surfaced via setLastError so the page can
        // render a transient state if it wants.
      } else {
        // Non-ApiError (network failure, TypeError, abort) — wrap into
        // an ApiError shape so the page sees a stable error contract
        // instead of a silent state-stays-null void. Code stays
        // 'NETWORK' and status 0 so callers can branch on it.
        setLastError(
          new ApiError(0, 'NETWORK', String(err), null),
        )
      }
    }
  }, [pollId])

  const { isPolling } = usePolling({
    fn,
    intervalMs: VERIFICATION_POLL_INTERVAL_MS,
    enabled,
  })

  const rerunOnce = useCallback(async () => {
    // Reset the terminal ref so the one-shot fetch can advance state
    // even if a prior 10-min cap committed 'timeout'. Guard against
    // resetting from 'verified' so a stray future caller cannot
    // un-verify a verified session — the recheck button only renders
    // inside the timeout branch today, but the guard locks the contract.
    if (terminalStateRef.current === 'timeout') {
      terminalStateRef.current = 'pending'
    }
    await fn()
  }, [fn])

  return {
    isPolling,
    lastResponse,
    lastError,
    commitTerminal,
    rerunOnce,
  }
}
