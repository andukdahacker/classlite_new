/**
 * AC6 — Sentry breadcrumb + captureException on every API call.
 *
 * The two assertions codify the cross-service correlation contract:
 *   - Successful calls emit a breadcrumb with the requestId from the
 *     x-request-id header — gives the Sentry transaction a key to match
 *     the Go API log line.
 *   - Non-2xx responses additionally call captureException with the
 *     requestId + errorCode tags — gives support the "paste the
 *     requestId; I'll find the Sentry event AND the API log" workflow.
 *
 * ESM namespace objects (`import * as Sentry from '@sentry/react'`) are
 * frozen by Vitest's transform, so `vi.spyOn` can't redefine their
 * properties. `vi.mock` with hoisted mocks is the supported pattern.
 */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { HttpResponse, http } from 'msw'
import { server } from '@/test/msw-server'
import { stubLocation, type StubbedLocation } from '@/test/location-stub'
import { apiFetch } from '@/lib/api-fetch'
import { __resetAuthRefreshStateForTests } from '@/lib/auth-refresh'

const mocks = vi.hoisted(() => ({
  addBreadcrumb: vi.fn(),
  captureException: vi.fn(() => 'event-id'),
  init: vi.fn(),
  browserTracingIntegration: vi.fn(() => ({ name: 'browserTracing' })),
  httpClientIntegration: vi.fn(() => ({ name: 'httpClient' })),
}))

vi.mock('@sentry/react', () => ({
  addBreadcrumb: mocks.addBreadcrumb,
  captureException: mocks.captureException,
  init: mocks.init,
  browserTracingIntegration: mocks.browserTracingIntegration,
  httpClientIntegration: mocks.httpClientIntegration,
}))

const REQUEST_ID = 'req-sentry-7'

let locationStub: StubbedLocation

beforeEach(() => {
  locationStub = stubLocation()
  mocks.addBreadcrumb.mockClear()
  mocks.captureException.mockClear()
  __resetAuthRefreshStateForTests()
})

afterEach(() => {
  locationStub.restore()
})

interface FetchBreadcrumbData {
  method?: string
  url?: string
  status?: number
  requestId?: string | null
}

interface Breadcrumb {
  category?: string
  data?: FetchBreadcrumbData
  level?: string
}

interface CaptureContext {
  tags?: { requestId?: string | null; errorCode?: string }
}

describe('AC6 Sentry breadcrumb contract', () => {
  test('200 response → addBreadcrumb fired with data.requestId from x-request-id header', async () => {
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json(
          { data: [] },
          { headers: { 'x-request-id': REQUEST_ID } },
        ),
      ),
    )
    await apiFetch('/api/students')
    expect(mocks.addBreadcrumb).toHaveBeenCalled()
    const breadcrumb = mocks.addBreadcrumb.mock.calls[0]?.[0] as
      | Breadcrumb
      | undefined
    expect(breadcrumb?.category).toBe('fetch')
    expect(breadcrumb?.data?.requestId).toBe(REQUEST_ID)
    expect(breadcrumb?.data?.status).toBe(200)
    expect(breadcrumb?.data?.url).toBe('/api/students')
  })

  test('422 response → captureException fired with tags.requestId + tags.errorCode', async () => {
    server.use(
      http.get('/api/students', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_ERROR', message: 'bad' } },
          {
            status: 422,
            headers: { 'x-request-id': REQUEST_ID },
          },
        ),
      ),
    )
    await apiFetch('/api/students').catch(() => null)

    expect(mocks.captureException).toHaveBeenCalled()
    const allCalls = mocks.captureException.mock.calls as unknown as Array<
      [unknown, CaptureContext | undefined]
    >
    const validationCall = allCalls.find(
      (args) => args[1]?.tags?.errorCode === 'VALIDATION_ERROR',
    )
    expect(validationCall).toBeDefined()
    expect(validationCall?.[1]?.tags?.requestId).toBe(REQUEST_ID)
    expect(validationCall?.[1]?.tags?.errorCode).toBe('VALIDATION_ERROR')
  })
})
