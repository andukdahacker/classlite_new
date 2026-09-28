/**
 * searchKeys — TS-3 query-key factory for the global-search palette (Story
 * 8-4b). One read: `GET /api/search?q=`. The server self-scopes by `tc.Role`,
 * so there are no per-role keys — the cache entry is inherently caller-specific
 * (the session cache clears on auth transition) and keyed only by the query
 * string. Each distinct `q` mints its own entry; `useSearch`'s short `gcTime`
 * reaps the long tail of a chatty session (no manual LRU).
 */
export const searchKeys = {
  all: ['search'] as const,
  query: (q: string) => [...searchKeys.all, q] as const,
} as const
