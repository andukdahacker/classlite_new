// Story 8-4b, Task 2 — the search query slice. RED-FIRST for the min-length /
// rune / held-pending gates (AC5, AC5a, AC6). `@/features/search/api/useSearch`
// does not exist yet (TS2307) at red.
//
// The falsifiability discipline (Murat):
//   • AC5 uses a SPY handler (a vi.fn() the MSW resolver calls) + a POSITIVE
//     control — 0 calls below the floor, exactly ONE call at "abc". A spy (not
//     MSW-throws) is the only way to tell "disabled" from "absent".
//   • AC5a pins the 3-rune rule as CODE POINTS on the pure `isSearchable`, so a
//     future switch to `String.length` (UTF-16 units) — which would count "à"
//     (combining) as 2 and an emoji as 2 units — reddens here. This is the one
//     place the FE and the Go rune floor could silently diverge (D14).
//   • AC6 proves keepPreviousData with a HELD-PENDING handler, not a timing race.
import { QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { HttpResponse, http } from 'msw'
import type { ReactNode } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { createTestQueryClient } from '@/lib/query-client'
import { server } from '@/test/msw-server'
import {
  isSearchable,
  queryRuneLength,
  SEARCH_MIN_QUERY_LENGTH,
  useSearch,
} from '@/features/search/api/useSearch'
import { emptyResults, populatedResults } from './handlers'

const SERVER_TIME = '2026-09-28T10:00:00.000Z'

function wrapper() {
  const client = createTestQueryClient()
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>
  }
}

afterEach(() => server.resetHandlers())

describe('useSearch — min-length floor is a SPY-measured zero-request gate (AC5)', () => {
  test.each(['', 'a', 'ab'])(
    'a sub-threshold q=%j issues ZERO network calls (enabled:false, spy-proven)',
    async (q) => {
      const spy = vi.fn()
      server.use(
        http.get('/api/search', () => {
          spy()
          return HttpResponse.json({ data: emptyResults, meta: { serverTime: SERVER_TIME } })
        }),
      )
      const { result } = renderHook(() => useSearch(q), { wrapper: wrapper() })
      // Give any (erroneously-enabled) query a chance to fire.
      await new Promise((r) => setTimeout(r, 20))
      expect(spy).not.toHaveBeenCalled()
      expect(result.current.fetchStatus).toBe('idle')
    },
  )

  test('POSITIVE control: q="abc" fires exactly ONCE with q=abc, encodeURIComponent-escaped', async () => {
    const spy = vi.fn<(q: string | null) => void>()
    server.use(
      http.get('/api/search', ({ request }) => {
        spy(new URL(request.url).searchParams.get('q'))
        return HttpResponse.json({ data: populatedResults, meta: { serverTime: SERVER_TIME } })
      }),
    )
    const { result } = renderHook(() => useSearch('abc'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy).toHaveBeenCalledWith('abc')
  })

  test('a q with spaces/accents is percent-escaped in the request URL', async () => {
    const spy = vi.fn<(raw: string) => void>()
    server.use(
      http.get('/api/search', ({ request }) => {
        spy(new URL(request.url).search)
        return HttpResponse.json({ data: emptyResults, meta: { serverTime: SERVER_TIME } })
      }),
    )
    const { result } = renderHook(() => useSearch('Nguyễn An'), { wrapper: wrapper() })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    // The raw search string is percent-encoded (space → %20, not "+"; diacritics escaped).
    expect(spy).toHaveBeenCalledWith(`?q=${encodeURIComponent('Nguyễn An')}`)
  })
})

describe('useSearch — the 3-rune rule is pinned as CODE POINTS, FE↔BE (AC5a, D14)', () => {
  const COMBINING_A_GRAVE = 'à' // "à" as base + combining mark → 2 code points
  const CA_COMBINING = 'cà' // "cà" → 3 code points (looks like 2 graphemes)

  test.each([
    ['ab', 2, false],
    [COMBINING_A_GRAVE, 2, false], // 2 code points, NOT 1 grapheme → below floor
    ['😀😀', 2, false], // surrogate pairs: 2 runes (String.length would say 4)
    ['abc', 3, true],
    [CA_COMBINING, 3, true], // 3 code points → fires (matches Go RuneCount)
    ['😀😀😀', 3, true],
  ])('q=%j has %i runes → searchable=%s', (q, runes, searchable) => {
    expect(queryRuneLength(q)).toBe(runes)
    expect(isSearchable(q)).toBe(searchable)
  })

  test('the floor constant is 3 (mirrors the api.yaml rune minimum)', () => {
    expect(SEARCH_MIN_QUERY_LENGTH).toBe(3)
  })

  test('leading/trailing whitespace is trimmed before the rune count', () => {
    expect(isSearchable('  ab  ')).toBe(false)
    expect(isSearchable('  abc  ')).toBe(true)
  })
})

describe('useSearch — keepPreviousData holds prior results during a refetch (AC6)', () => {
  test('prior data STAYS rendered while the next query is held pending, then swaps', async () => {
    // Deferred handler for the SECOND query so we can hold B pending. Seeded
    // with a no-op so the type stays a plain callable (never null-narrowed).
    let releaseB: () => void = () => {}
    server.use(
      http.get('/api/search', async ({ request }) => {
        const q = new URL(request.url).searchParams.get('q')
        if (q === 'apples') {
          return HttpResponse.json({ data: populatedResults, meta: { serverTime: SERVER_TIME } })
        }
        // q === 'bananas' — hold until the test releases it.
        await new Promise<void>((resolve) => {
          releaseB = resolve
        })
        return HttpResponse.json({ data: emptyResults, meta: { serverTime: SERVER_TIME } })
      }),
    )

    const { result, rerender } = renderHook(({ q }) => useSearch(q), {
      wrapper: wrapper(),
      initialProps: { q: 'apples' },
    })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    const aData = result.current.data
    expect(aData?.classes.items).toHaveLength(1)

    // Switch to a query whose response we hold pending.
    rerender({ q: 'bananas' })
    await waitFor(() => expect(result.current.isFetching).toBe(true))
    // keepPreviousData: A's items are STILL the rendered data (no empty-flash).
    expect(result.current.data).toBe(aData)
    expect(result.current.isPlaceholderData).toBe(true)

    // Release B → the empty payload replaces A.
    releaseB()
    await waitFor(() => expect(result.current.isPlaceholderData).toBe(false))
    expect(result.current.data?.classes.items).toHaveLength(0)
  })
})
