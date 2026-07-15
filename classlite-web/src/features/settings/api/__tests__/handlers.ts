/**
 * MSW handlers for Story 2-5a settings feature.
 *
 * Contract per TEST-FE-1: default handlers ship happy-path only. Per-test
 * error variants register via `server.use(errorHandlers.<variant>)`.
 * `afterEach(server.resetHandlers())` wipes overrides.
 *
 * apiFetch unwraps the {data,meta} envelope — MSW returns the full shape.
 */
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type EnvelopeMeta = { serverTime: string }
type Envelope<T> = { data: T; meta: EnvelopeMeta }
type CenterProfile = components['schemas']['CenterProfile']

const FIXED_SERVER_TIME = '2026-07-14T00:00:00.000Z'

export const DEFAULT_CENTER_ID = '11111111-2222-3333-4444-555555555599'

/* eslint-disable no-restricted-syntax -- brand-color wire value fixture (FU-2-3a-C) */
export const defaultCenterProfile: CenterProfile = {
  id: DEFAULT_CENTER_ID,
  name: 'Saigon English Center',
  shortCode: 'saigon-english-center',
  contactEmail: null,
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  googleMeetConnected: false,
  createdAt: '2026-07-01T09:00:00.000Z',
}
/* eslint-enable no-restricted-syntax */

function envelope<T>(data: T): Envelope<T> {
  return { data, meta: { serverTime: FIXED_SERVER_TIME } }
}

export function centerProfile(
  overrides: Partial<CenterProfile> = {},
): CenterProfile {
  return { ...defaultCenterProfile, ...overrides }
}

/** Happy-path handler set — a fresh GET returns defaultCenterProfile; a
 * fresh PATCH echoes the request fields onto the profile. */
export const settingsHandlers = [
  http.get('/api/centers/:id', ({ params }) => {
    return HttpResponse.json(
      envelope(centerProfile({ id: String(params.id) })),
    )
  }),
  http.patch('/api/centers/:id', async ({ request, params }) => {
    const body = (await request.json()) as Partial<CenterProfile>
    return HttpResponse.json(
      envelope({
        ...centerProfile({ id: String(params.id) }),
        ...('name' in body ? { name: body.name as string } : {}),
        ...('contactEmail' in body
          ? { contactEmail: (body.contactEmail as string | null) ?? null }
          : {}),
        ...('brandColor' in body
          ? { brandColor: (body.brandColor as string | null) ?? null }
          : {}),
        ...('timezone' in body
          ? { timezone: body.timezone as string }
          : {}),
      }),
    )
  }),
]

/** Fault-injection error variants — one per row of the 5-error matrix. */
export const errorHandlers = {
  centerProfileFetch500: () =>
    http.get('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-fetch-500',
            details: null,
          },
        },
        { status: 500 },
      )
    }),
  patchValidation422: (field = 'contactEmail') =>
    http.patch('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Validation failed.',
            requestId: 'req-422',
            details: [{ field, message: 'must be a valid email address' }],
          },
        },
        { status: 422 },
      )
    }),
  patchForbidden403: () =>
    http.patch('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INSUFFICIENT_ROLE',
            message: 'Insufficient role.',
            requestId: 'req-403',
            details: null,
          },
        },
        { status: 403 },
      )
    }),
  patchAuth401: () =>
    http.patch('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'AUTH_INVALID',
            message: 'Auth invalid.',
            requestId: 'req-401',
            details: null,
          },
        },
        { status: 401 },
      )
    }),
  patchRateLimit429: (retryAfterSeconds = 30) =>
    http.patch('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests.',
            requestId: 'req-429',
            details: null,
          },
        },
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        },
      )
    }),
  patchInternal500: () =>
    http.patch('/api/centers/:id', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error.',
            requestId: 'req-500',
            details: null,
          },
        },
        { status: 500 },
      )
    }),
}
