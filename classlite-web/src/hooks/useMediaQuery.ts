/**
 * useMediaQuery — subscribe to a CSS media query via `useSyncExternalStore`
 * (the React 19 external-store idiom — no `useEffect`, no data fetching). Returns
 * whether the query currently matches and re-renders on change.
 *
 * Used by screens that render a genuinely different component tree per breakpoint
 * (UX-4) — mounting only ONE tree, so ids/`data-testid`s are never duplicated.
 */
import { useCallback, useSyncExternalStore } from 'react'

/**
 * @param query a media query string, e.g. `'(min-width: 768px)'`.
 * @returns `true` when the query matches; `false` during SSR / before hydration.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const list = window.matchMedia(query)
      list.addEventListener('change', notify)
      return () => list.removeEventListener('change', notify)
    },
    [query],
  )
  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query])
  return useSyncExternalStore(subscribe, getSnapshot, () => false)
}

/** The Tailwind `md` breakpoint — the desktop/mobile split for the attempt UI. */
export const DESKTOP_MEDIA_QUERY = '(min-width: 768px)'

/** True on the desktop (`md`+) breakpoint. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_MEDIA_QUERY)
}
