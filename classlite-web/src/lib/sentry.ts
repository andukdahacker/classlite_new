/**
 * Sentry init + thin re-export surface.
 *
 * `initSentry()` is called once from main.tsx BEFORE createRoot. When
 * `VITE_SENTRY_DSN` is unset (local dev without `.env.local`), init
 * silently no-ops so the dashboard still boots cleanly — Sentry's own
 * `addBreadcrumb` / `captureException` become no-ops in that state.
 *
 * Two design decisions worth flagging:
 *
 *   - The breadcrumb data shape we care about — `{ method, url, status,
 *     requestId }` — is attached at the origin (apiFetch) rather than
 *     via a global `beforeBreadcrumb` hook, so the requestId flows
 *     straight from the response header into the breadcrumb without an
 *     extra indirection. AC6 listed `beforeBreadcrumb` in the spec
 *     shape; attaching at origin is equivalent and avoids the indirect
 *     lookup.
 *
 *   - `httpClientIntegration` is intentionally omitted. It instruments
 *     `fetch` and emits its own breadcrumb on every call — combined
 *     with apiFetch's explicit `addBreadcrumb` it would double-emit on
 *     every API request, inflating breadcrumb volume in Sentry and
 *     making the request_id correlation less searchable. `apiFetch`
 *     is the single network seam in this codebase (AC8 ESLint guard),
 *     so origin-level breadcrumbs are sufficient.
 */
import * as Sentry from '@sentry/react'

const TRACES_SAMPLE_RATE = 0.1

export function initSentry(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN
  if (!dsn) return
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_RELEASE_SHA ?? 'dev',
    tracesSampleRate: TRACES_SAMPLE_RATE,
    integrations: [Sentry.browserTracingIntegration()],
  })
}
