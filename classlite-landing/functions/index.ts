/**
 * Cloudflare Pages Function — `GET /` locale router. Story 1.10 AC1 +
 * R-NEW-54 mitigation.
 *
 * Astro static output can't per-request branch (`Astro.request.headers`
 * at build time returns the build-runner header, baking ONE locale for
 * every visitor). This Function runs at the CF edge per-request,
 * reads `Accept-Language`, picks `/vi/` or `/en/`, and emits
 * `Vary: Accept-Language` so the edge cache stores both branches.
 *
 * CF Pages auto-picks up `functions/` at deploy time (no
 * `wrangler.toml` config needed for the default routing). The
 * `/<locale>/...` paths are static HTML served by Astro and pass
 * through this Function untouched (only the bare `/` matches).
 *
 * Vietnamese is the co-primary market (UX-2) — tie-breakers and
 * absent-header defaults route to `/vi/`.
 *
 * Method handling — GET + HEAD pass through the locale router. All
 * other methods receive 405 with `Allow: GET, HEAD` per decision D2
 * from the 2026-06-30 code review.
 *
 * Query string + hash are preserved on the redirect (P15) so UTM /
 * `?session_expired=true` / `?billing=annual` survive the bounce.
 * Cache-Control is explicit (P16) so intermediate proxies cannot
 * collapse per-locale responses behind the Vary header.
 *
 * Body (export onRequest + helpers) ≤ 35 lines; total with JSDoc
 * comments is intentionally larger.
 */

interface ParsedLang {
  tag: string
  q: number
}

function parseAcceptLanguage(header: string): ParsedLang[] {
  return header
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [tag, ...params] = entry.split(';')
      const qParam = params.find((p) => p.trim().startsWith('q='))
      let q = 1
      if (qParam !== undefined) {
        const qRaw = qParam.split('=')[1]?.trim()
        if (!qRaw) {
          /* RFC 7231 §5.3.1: `q=` with no value is malformed — drop
             the entry by scoring it 0. P6 from code review. */
          q = 0
        } else {
          const parsed = Number.parseFloat(qRaw)
          q = Number.isFinite(parsed) ? Math.min(1, Math.max(0, parsed)) : 0
        }
      }
      return { tag: tag.toLowerCase(), q }
    })
    .filter((p) => p.tag.length > 0 && p.q > 0)
}

function pickLocale(header: string | null): 'vi' | 'en' {
  if (!header) return 'vi'
  const parsed = parseAcceptLanguage(header)
  let viScore = 0
  let enScore = 0
  for (const { tag, q } of parsed) {
    if (tag === 'vi' || tag.startsWith('vi-')) viScore = Math.max(viScore, q)
    else if (tag === 'en' || tag.startsWith('en-'))
      enScore = Math.max(enScore, q)
  }
  if (viScore === 0 && enScore === 0) return 'vi'
  return enScore > viScore ? 'en' : 'vi'
}

interface PagesContext {
  request: Request
}

const ALLOWED_METHODS = 'GET, HEAD'

export const onRequest = ({ request }: PagesContext): Response => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response(null, {
      status: 405,
      headers: { Allow: ALLOWED_METHODS },
    })
  }
  const locale = pickLocale(request.headers.get('Accept-Language'))
  const url = new URL(request.url)
  return new Response(null, {
    status: 302,
    headers: {
      Location: `/${locale}/${url.search}${url.hash}`,
      Vary: 'Accept-Language',
      'Cache-Control': 'private, max-age=0',
    },
  })
}
