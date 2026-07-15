/**
 * MSW handlers for Story 2-5a + 2-5b settings feature.
 *
 * Contract per TEST-FE-1: default handlers ship happy-path only. Per-test
 * error variants register via `server.use(errorHandlers.<variant>)`.
 * `afterEach(server.resetHandlers())` wipes overrides.
 *
 * apiFetch unwraps the {data,meta} envelope — MSW returns the full shape.
 *
 * Story 2-5b extension (ATDD red-phase 2026-07-15): terms + holidays + rooms
 * factories + happy-path CRUD handlers + a `roomNameTaken409` fault variant
 * for the AC6 UNIQUE-collision test. Handler set exported as
 * `settingsHandlers2_5b` so 2-5a's `settingsHandlers` stays lean for the
 * ProfileTab tests. `beforeEach(server.use(...settingsHandlers2_5b))` in
 * the new TermCalendarTab + RoomsTab tests picks it up.
 */
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type EnvelopeMeta = { serverTime: string }
type Envelope<T> = { data: T; meta: EnvelopeMeta }
type CenterProfile = components['schemas']['CenterProfile']
// Story 2-5b — these API schemas land in Task 3 (api.yaml + regen).
// At red-phase time the generated types don't exist, so we declare lean
// wire-shape aliases inline so this handler file stays type-clean.
type Term = {
  id: string
  centerId: string
  name: string
  startDate: string
  endDate: string
  sessionCount: number | null
}
type Holiday = {
  id: string
  centerId: string
  name: string
  date: string
}
type Room = {
  id: string
  centerId: string
  name: string
  description: string | null
  capacity: number
}

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

  // Story 2-5b — AC6 UNIQUE(center_id, LOWER(name)) collision on POST /rooms
  // renders as inline field error, NOT a toast. `details[0].field === 'name'`
  // tells the client which input to surface the error on.
  roomNameTaken409: () =>
    http.post('/api/rooms', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'ROOM_NAME_TAKEN',
            message: 'A room with this name already exists in this center.',
            requestId: 'req-409-room',
            details: [{ field: 'name', message: 'room name must be unique' }],
          },
        },
        { status: 409 },
      )
    }),

  // Story 2-5b — GET-side fault for the three-state trilogy tests.
  listTerms500: () =>
    http.get('/api/terms', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-terms-500',
            details: null,
          },
        },
        { status: 500 },
      )
    }),
  listHolidays500: () =>
    http.get('/api/holidays', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-holidays-500',
            details: null,
          },
        },
        { status: 500 },
      )
    }),
  listRooms500: () =>
    http.get('/api/rooms', () => {
      return HttpResponse.json(
        {
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Internal error',
            requestId: 'req-rooms-500',
            details: null,
          },
        },
        { status: 500 },
      )
    }),
}

// -----------------------------------------------------------------------------
// Story 2-5b — terms + holidays + rooms fixtures + happy-path handler set.
// -----------------------------------------------------------------------------

export const defaultTerms: Term[] = [
  {
    id: '00000000-0000-0000-0000-00000000t001',
    centerId: DEFAULT_CENTER_ID,
    name: 'Fall 2026',
    startDate: '2026-08-01',
    endDate: '2026-12-15',
    sessionCount: 36,
  },
  {
    id: '00000000-0000-0000-0000-00000000t002',
    centerId: DEFAULT_CENTER_ID,
    name: 'Spring 2027',
    startDate: '2027-01-15',
    endDate: '2027-05-30',
    sessionCount: 40,
  },
]

export const defaultHolidays: Holiday[] = [
  {
    id: '00000000-0000-0000-0000-00000000h001',
    centerId: DEFAULT_CENTER_ID,
    name: 'National Day',
    date: '2026-09-02',
  },
]

export const defaultRooms: Room[] = [
  {
    id: '00000000-0000-0000-0000-00000000r001',
    centerId: DEFAULT_CENTER_ID,
    name: 'Room 101',
    description: 'Ground floor — projector + whiteboard',
    capacity: 20,
  },
  {
    id: '00000000-0000-0000-0000-00000000r002',
    centerId: DEFAULT_CENTER_ID,
    name: 'Room 202',
    description: null,
    capacity: 12,
  },
]

export function term(overrides: Partial<Term> = {}): Term {
  return { ...defaultTerms[0], ...overrides }
}
export function holiday(overrides: Partial<Holiday> = {}): Holiday {
  return { ...defaultHolidays[0], ...overrides }
}
export function room(overrides: Partial<Room> = {}): Room {
  return { ...defaultRooms[0], ...overrides }
}

/**
 * Happy-path handler set for the Story 2-5b tab bodies. Extends the 2-5a
 * profile handlers with CRUD across the 3 new entities. GET returns the
 * default fixtures; POST/PATCH echo request payloads onto the fixture;
 * DELETE returns 204.
 */
export const settingsHandlers2_5b = [
  ...settingsHandlers,
  http.get('/api/terms', () => HttpResponse.json(envelope(defaultTerms))),
  http.post('/api/terms', async ({ request }) => {
    const body = (await request.json()) as Partial<Term>
    return HttpResponse.json(
      envelope(term({ id: 'new-term-id', ...body })),
      { status: 201 },
    )
  }),
  http.patch('/api/terms/:id', async ({ request, params }) => {
    const body = (await request.json()) as Partial<Term>
    return HttpResponse.json(
      envelope(term({ id: String(params.id), ...body })),
    )
  }),
  http.delete('/api/terms/:id', () => new HttpResponse(null, { status: 204 })),

  http.get('/api/holidays', () =>
    HttpResponse.json(envelope(defaultHolidays)),
  ),
  http.post('/api/holidays', async ({ request }) => {
    const body = (await request.json()) as Partial<Holiday>
    return HttpResponse.json(
      envelope(holiday({ id: 'new-holiday-id', ...body })),
      { status: 201 },
    )
  }),
  http.patch('/api/holidays/:id', async ({ request, params }) => {
    const body = (await request.json()) as Partial<Holiday>
    return HttpResponse.json(
      envelope(holiday({ id: String(params.id), ...body })),
    )
  }),
  http.delete(
    '/api/holidays/:id',
    () => new HttpResponse(null, { status: 204 }),
  ),

  http.get('/api/rooms', () => HttpResponse.json(envelope(defaultRooms))),
  http.post('/api/rooms', async ({ request }) => {
    const body = (await request.json()) as Partial<Room>
    return HttpResponse.json(
      envelope(room({ id: 'new-room-id', ...body })),
      { status: 201 },
    )
  }),
  http.patch('/api/rooms/:id', async ({ request, params }) => {
    const body = (await request.json()) as Partial<Room>
    return HttpResponse.json(
      envelope(room({ id: String(params.id), ...body })),
    )
  }),
  http.delete('/api/rooms/:id', () => new HttpResponse(null, { status: 204 })),
]
