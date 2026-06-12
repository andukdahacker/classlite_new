/**
 * usePolling — debounce-aware interval hook with cleanup.
 *
 * First consumer: Story 1-9a's email verification poller (UX-DR9 — polls
 * /api/auth/verify-status every 5s for up to 10 minutes). usePolling does
 * NOT enforce the 10-min cap — that's the consumer's responsibility via
 * `enabled=false` once the cap is reached.
 *
 * Why this exists today instead of inlining the interval at the call site:
 * three Epic 1C-and-later stories need polling with cleanup (1-9a verify,
 * Epic 9 billing-grace countdown, Epic 10 inbox unread badge). Centralizing
 * the cleanup discipline prevents three near-identical buggy useEffects.
 *
 * The single `useEffect` here falls under project-context FW-4's permitted
 * exception ("subscription cleanup") — NOT a server-state fetch.
 */
import { useEffect, useRef, useState } from 'react'
import * as Sentry from '@sentry/react'

export interface UsePollingOpts {
  fn: () => Promise<unknown>
  intervalMs: number
  enabled?: boolean
}

export interface UsePollingResult {
  isPolling: boolean
}

export function usePolling({
  fn,
  intervalMs,
  enabled = true,
}: UsePollingOpts): UsePollingResult {
  const [isPolling, setIsPolling] = useState(false)
  const fnRef = useRef(fn)

  // Keep the ref pointed at the latest `fn` so the interval's invocation
  // always uses the freshest closure. Writing the ref inside a separate
  // effect (rather than during render) is the React-19-canonical
  // pattern and satisfies `react-hooks/refs`.
  useEffect(() => {
    fnRef.current = fn
  }, [fn])

  useEffect(() => {
    // `react-hooks/set-state-in-effect` warns against state writes
    // inside useEffect because they trigger a follow-up render. Here the
    // `isPolling` flag IS effect-derived state — it mirrors the
    // interval lifecycle — so the follow-up render is the desired
    // observable signal for consumers reading `result.current.isPolling`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsPolling(enabled)
    if (!enabled) return
    // Guard against intervalMs=0/NaN/Infinity which would either flood
    // the tab (clamped to ~4ms) or never fire — both silent failure modes.
    if (!Number.isFinite(intervalMs) || intervalMs <= 0) return
    const id = setInterval(() => {
      try {
        const result = fnRef.current()
        if (result && typeof (result as Promise<unknown>).catch === 'function') {
          ;(result as Promise<unknown>).catch((err: unknown) => {
            Sentry.captureException(err)
          })
        }
      } catch (err) {
        Sentry.captureException(err)
      }
    }, intervalMs)
    return () => {
      clearInterval(id)
    }
  }, [enabled, intervalMs])

  return { isPolling }
}
