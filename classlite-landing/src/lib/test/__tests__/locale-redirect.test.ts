/**
 * locale-redirect — Story 1.10 AC1 R-NEW-54 ATDD unit-test surface.
 *
 * The CF Pages Function at `functions/index.ts` is pure logic — it
 * reads `Accept-Language`, picks `vi` or `en`, returns a 302 with
 * `Vary: Accept-Language`. Unit-testing the handler here gives a
 * fast RED→GREEN loop; the Playwright e2e at
 * `e2e/locale-redirect.spec.ts` is the WF-8 ATDD evidence and runs
 * against `wrangler pages dev` in CI / locally at Task 10 verification.
 */
import { describe, expect, test } from 'vitest'
import { onRequest } from '../../../../functions/index'

interface PagesFunctionContext {
  request: Request
}

async function callFn(
  headers: Record<string, string> = {},
  init?: { method?: string; url?: string },
): Promise<Response> {
  const request = new Request(init?.url ?? 'https://classlite.app/', {
    headers,
    method: init?.method ?? 'GET',
  })
  const ctx = { request } as unknown as PagesFunctionContext
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (onRequest as any)(ctx) as Response
}

describe('CF Pages Function — / locale redirect (R-NEW-54)', () => {
  test('Accept-Language vi-VN → 302 to /vi/', async () => {
    const res = await callFn({ 'Accept-Language': 'vi-VN,vi;q=0.9' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('Accept-Language en-US → 302 to /en/', async () => {
    const res = await callFn({ 'Accept-Language': 'en-US,en;q=0.9' })
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/en/')
  })

  test('tied q-weights → /vi/ (Vietnamese tie-breaker per UX-2)', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=0.7,vi;q=0.7' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('no Accept-Language header → /vi/ (default)', async () => {
    const res = await callFn({})
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('emits Vary: Accept-Language (CF cache axis)', async () => {
    const res = await callFn({ 'Accept-Language': 'vi-VN,vi;q=0.9' })
    expect(res.headers.get('Vary')).toBe('Accept-Language')
  })

  test('higher q wins regardless of order', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=0.5,vi;q=0.9' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('malformed Accept-Language → /vi/ (graceful default)', async () => {
    const res = await callFn({ 'Accept-Language': 'garbage;;;q=' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('en-only no Vietnamese listed → /en/', async () => {
    const res = await callFn({ 'Accept-Language': 'en-GB,en;q=0.9' })
    expect(res.headers.get('Location')).toBe('/en/')
  })

  test('fr-FR no en or vi → /vi/ (default)', async () => {
    const res = await callFn({ 'Accept-Language': 'fr-FR,fr;q=0.9' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  /* The block below covers the edge cases that code review 2026-06-30
     surfaced (P6, P17, P30) — RFC 7231 conformance, query/hash
     preservation, method gating, and explicit Cache-Control. */

  test('q=0 explicitly rejects the language even if it would otherwise win', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=0,vi;q=0.5' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('q=0 on both en and vi → falls through to the /vi/ default', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=0,vi;q=0' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('q-param with no value (e.g. `en;q=`) drops the entry (RFC 7231)', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=,vi;q=0.5' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('whitespace-only Accept-Language → /vi/ (default)', async () => {
    const res = await callFn({ 'Accept-Language': '   ' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('comma-only Accept-Language → /vi/ (default)', async () => {
    const res = await callFn({ 'Accept-Language': ',,,' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('wildcard `*` Accept-Language → /vi/ (no en or vi listed)', async () => {
    const res = await callFn({ 'Accept-Language': '*' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('q > 1 is clamped to 1', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=5,vi;q=0.9' })
    /* en clamps to 1; vi at 0.9. en wins. */
    expect(res.headers.get('Location')).toBe('/en/')
  })

  test('q < 0 is clamped to 0 (entry dropped)', async () => {
    const res = await callFn({ 'Accept-Language': 'en;q=-1,vi;q=0.5' })
    expect(res.headers.get('Location')).toBe('/vi/')
  })

  test('preserves query string on redirect (P15)', async () => {
    const res = await callFn(
      { 'Accept-Language': 'vi-VN' },
      { url: 'https://classlite.app/?session_expired=true&utm_source=fb' },
    )
    expect(res.headers.get('Location')).toBe(
      '/vi/?session_expired=true&utm_source=fb',
    )
  })

  test('emits explicit Cache-Control: private, max-age=0 (P16)', async () => {
    const res = await callFn({ 'Accept-Language': 'vi-VN' })
    expect(res.headers.get('Cache-Control')).toBe('private, max-age=0')
  })

  test('HEAD method passes through with the same 302 + headers (D2)', async () => {
    const res = await callFn(
      { 'Accept-Language': 'vi-VN' },
      { method: 'HEAD' },
    )
    expect(res.status).toBe(302)
    expect(res.headers.get('Location')).toBe('/vi/')
    expect(res.headers.get('Vary')).toBe('Accept-Language')
  })

  test('POST method → 405 with Allow: GET, HEAD (D2)', async () => {
    const res = await callFn(
      { 'Accept-Language': 'vi-VN' },
      { method: 'POST' },
    )
    expect(res.status).toBe(405)
    expect(res.headers.get('Allow')).toBe('GET, HEAD')
  })
})
