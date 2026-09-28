/**
 * useSearch — the ONE aggregate read behind the global-search palette (Story
 * 8-4b, D3/D4/D13). `GET /api/search?q=` returns the whole 5-category
 * `SearchResults` payload; the server enforces ALL role/tenant scope, so the FE
 * renders whatever comes back and NEVER re-derives scope (R-1).
 *
 * Mirrors the analytics hook template but uses PLAIN `apiFetch` (TS-4: unwraps
 * `.data`, drops `meta` — search has no pagination meta), NOT `apiFetchWithMeta`.
 * The tuning that keeps the palette calm under per-keystroke typing (R-2):
 *   - `enabled` on the 3-RUNE floor (D4/D14) → zero sub-threshold requests. Runes
 *     are counted as CODE POINTS (`[...q.trim()].length`) to match the backend's
 *     rune floor exactly ("cà" is 2 UTF-16 units but a legitimate 2-rune input;
 *     an emoji is ≥2 units) — the one place FE and BE could silently diverge.
 *   - `placeholderData: keepPreviousData` → no empty-flash between keystrokes.
 *   - `signal` forwarded into `apiFetch` → a superseded in-flight request aborts
 *     on supersede/unmount (D13). NO manual AbortController, NO max-in-flight
 *     guard — debounce is the throttle, the query key + signal are the cleanup.
 *   - `staleTime` ~12s (shorter than the 30s default: search hits mutating
 *     enrollments/assignments) + a short `gcTime` to reap the per-`q` cache tail.
 *
 * The caller debounces `q` (via `useDebouncedValue`) BEFORE passing it here.
 */
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { searchKeys } from './searchKeys'

export type SearchResults = components['schemas']['SearchResults']
export type SearchCategory = components['schemas']['SearchCategory']
export type SearchResultItem = components['schemas']['SearchResultItem']

/** The client min-length floor — mirrors the server's 3-rune minimum (api.yaml
 *  `q` description, 8-4a Sally C2) so the two can never drift. */
export const SEARCH_MIN_QUERY_LENGTH = 3
/** The per-keystroke debounce window (D2). */
export const SEARCH_DEBOUNCE_MS = 300
/** Shorter than the 30s project default — search reads mutating data (D3). */
export const SEARCH_STALE_TIME_MS = 12_000
/** Reap the per-`q` cache entries a chatty session mints (D3). */
export const SEARCH_GC_TIME_MS = 60_000

/** Code-point (rune) length of the trimmed query — the FE↔BE-pinned count (D14). */
export function queryRuneLength(q: string): number {
  return [...q.trim()].length
}

/** True when `q` clears the client min-length floor (and a request should fire). */
export function isSearchable(q: string): boolean {
  return queryRuneLength(q) >= SEARCH_MIN_QUERY_LENGTH
}

/**
 * The global-search read for one (already-debounced) query string. Disabled
 * below the 3-rune floor, so a sub-threshold `q` issues zero network calls.
 *
 * `q` is TRIMMED before it becomes the cache key and the request URL (code review
 * 2026-09-28): the searchable gate already trims, so an untrimmed key/URL would
 * mint a distinct cache entry per whitespace variant (`"abc"` vs `"abc "`) and
 * send padded `q=%20%20abc` to the server (which trims anyway). Normalizing here
 * keeps the two in lockstep and is robust regardless of the caller.
 */
export function useSearch(q: string) {
  const normalizedQuery = q.trim()
  return useQuery({
    queryKey: searchKeys.query(normalizedQuery),
    queryFn: ({ signal }) =>
      apiFetch<SearchResults>(
        `/api/search?q=${encodeURIComponent(normalizedQuery)}`,
        { signal },
      ),
    enabled: isSearchable(normalizedQuery),
    placeholderData: keepPreviousData,
    staleTime: SEARCH_STALE_TIME_MS,
    gcTime: SEARCH_GC_TIME_MS,
  })
}
