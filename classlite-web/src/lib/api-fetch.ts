/**
 * apiFetch — the single network entry point for the dashboard.
 *
 * Every component that needs the API goes through `apiFetch`. The ESLint
 * guard (AC8) makes a raw `fetch` or `axios` import inside features/hooks
 * a hard error, so the rule is enforced at compile time and verified by
 * unit + integration lint tests.
 *
 * Responsibilities:
 *   - `credentials: 'include'` on every request so the httpOnly auth
 *     cookies set by the Go API flow on every call.
 *   - Unwrap the `{ data, meta }` envelope (project-context TS-4 — the rest
 *     of the codebase never sees `.data.data`). The `meta` block is dropped
 *     at this layer; pagination consumers add explicit handling per-feature.
 *   - On a 401, hand off to the global refresh coordinator
 *     (auth-refresh.ts) for an exactly-once silent refresh and retry the
 *     original request once. The `skipAuthRefresh` flag short-circuits the
 *     recursion for callers that already know recovery is impossible
 *     (currently used only by the refresh module itself for symmetry).
 *   - Attach a Sentry breadcrumb on every call with `{ method, url,
 *     status, requestId }` and capture an exception with the
 *     `requestId` + `errorCode` tags on non-2xx responses. The
 *     `x-request-id` response header is the cross-service correlation
 *     handle so the Go API logs and the Sentry event share a key.
 *
 * Dates are NOT parsed here — they stay as ISO strings until the i18n
 * formatter (project-context TS-6).
 */
import * as Sentry from '@sentry/react'
import { onAuthFailure, refreshAccessToken } from './auth-refresh'

const NETWORK_STATUS = 0
const UNAUTHORIZED_STATUS = 401
const NO_CONTENT_STATUS = 204

export class ApiError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string | null
  readonly details: unknown

  constructor(
    status: number,
    code: string,
    message: string,
    requestId: string | null,
    details?: unknown,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.requestId = requestId
    this.details = details
  }
}

export class AuthExpiredError extends Error {
  constructor() {
    super('Authentication expired')
    this.name = 'AuthExpiredError'
  }
}

export interface ApiFetchOptions extends RequestInit {
  skipAuthRefresh?: boolean
}

interface ErrorEnvelope {
  error?: {
    code?: string
    message?: string
    details?: unknown
  }
}

interface SuccessEnvelope<T> {
  data: T
}

export async function apiFetch<T = unknown>(
  path: string,
  opts: ApiFetchOptions = {},
): Promise<T> {
  const { skipAuthRefresh, ...rest } = opts
  let response = await performFetch(path, rest)

  if (response.status === UNAUTHORIZED_STATUS) {
    if (skipAuthRefresh) {
      throw new AuthExpiredError()
    }
    const refreshResult = await refreshAccessToken()
    if (!refreshResult.ok) {
      // Local-tab redirect — sibling tabs handle their own via the
      // refresh-failed broadcast listener in auth-refresh.ts.
      // `onAuthFailure` is latched against double-fire, so a parallel
      // QueryCache.onError invocation collapses to a single redirect.
      const authError = new AuthExpiredError()
      onAuthFailure(authError)
      throw authError
    }
    response = await performFetch(path, rest)
    // After a successful refresh, a SECOND 401 on the retry means the
    // session is genuinely unrecoverable (server-side revoke during the
    // refresh window, debounce-mask vs revoked cookies, backend race).
    // Treat as an auth failure rather than letting `ApiError(401)`
    // escape — components contract on `AuthExpiredError | ApiError(≠401)`.
    if (response.status === UNAUTHORIZED_STATUS) {
      const authError = new AuthExpiredError()
      onAuthFailure(authError)
      throw authError
    }
  }

  return parseEnvelope<T>(response)
}

async function performFetch(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const method = init.method ?? 'GET'
  try {
    const response = await fetch(path, { credentials: 'include', ...init })
    const requestId = response.headers.get('x-request-id')
    Sentry.addBreadcrumb({
      category: 'fetch',
      level: response.ok ? 'info' : 'error',
      data: { method, url: path, status: response.status, requestId },
    })
    return response
  } catch (cause) {
    const networkError = new ApiError(
      NETWORK_STATUS,
      'NETWORK',
      'Network request failed',
      null,
      cause,
    )
    Sentry.addBreadcrumb({
      category: 'fetch',
      level: 'error',
      data: { method, url: path, status: NETWORK_STATUS, requestId: null },
    })
    Sentry.captureException(networkError, {
      tags: { requestId: null, errorCode: 'NETWORK' },
    })
    throw networkError
  }
}

async function parseEnvelope<T>(response: Response): Promise<T> {
  const requestId = response.headers.get('x-request-id')

  if (response.ok) {
    if (response.status === NO_CONTENT_STATUS) {
      return undefined as T
    }
    const text = await response.text()
    if (!text) return undefined as T
    let body: SuccessEnvelope<T>
    try {
      body = JSON.parse(text) as SuccessEnvelope<T>
    } catch {
      // Non-JSON 2xx body (captive portal HTML interstitial, proxy
      // mis-config, broken backend). Surface a typed ApiError so the
      // contract "apiFetch only throws ApiError or AuthExpiredError"
      // holds and the failure flows through the same Sentry pipeline.
      const malformedError = new ApiError(
        response.status,
        'INVALID_RESPONSE',
        'Response body was not valid JSON',
        requestId,
      )
      Sentry.captureException(malformedError, {
        tags: { requestId, errorCode: 'INVALID_RESPONSE' },
      })
      throw malformedError
    }
    return body.data
  }

  const errorBody = (await response
    .json()
    .catch(() => ({}) as ErrorEnvelope)) as ErrorEnvelope
  const apiError = new ApiError(
    response.status,
    errorBody.error?.code ?? 'UNKNOWN',
    errorBody.error?.message ?? response.statusText,
    requestId,
    errorBody.error?.details,
  )
  Sentry.captureException(apiError, {
    tags: { requestId, errorCode: apiError.code },
  })
  throw apiError
}
