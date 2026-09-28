import { useEffect, useState } from 'react'

/**
 * useDebouncedValue — returns `value` delayed by `delayMs`, resetting the timer
 * on every change so a burst of rapid updates collapses to a single settled
 * value (Story 8-4b, D2).
 *
 * Domain-agnostic (a peer of `useRole`): the search palette debounces its raw
 * query value through this before handing it to `useSearch`, which is what
 * makes a keystroke burst issue exactly ONE request for the final query
 * (project-context R-2 — no per-keystroke request storm). The pending timer is
 * cleared on unmount and on every value change, so no post-unmount state write
 * ever fires.
 *
 * @param value the live value to debounce.
 * @param delayMs the quiet-period in milliseconds before the value settles.
 * @returns the most recent value that has been stable for `delayMs`.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState<T>(value)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs)
    return () => clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
