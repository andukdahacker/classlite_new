/**
 * MSW handlers for Story 2-3a onboarding — the 4 endpoints Story 2.1 shipped
 * (setOnboardingPersona / createCenter / getOnboardingProgress /
 * putOnboardingProgress). Contract inventory mirrors Story 2-3a Dev Notes
 * §"MSW handler contract inventory" — 2xx / 4xx bodies + Retry-After header
 * on 429 shapes pinned so tests don't drift from the Go API.
 *
 * Contract per project-context TEST-FE-1: default handlers ship happy-path
 * only; per-test error variants register via `server.use(...)` overrides.
 * `afterEach(server.resetHandlers())` in `vitest-setup.ts` wipes overrides.
 *
 * apiFetch unwraps the envelope — MSW returns the FULL `{data, meta}` shape;
 * the mutation onSuccess receives `body.data`. `meta` is dropped by
 * apiFetch (Winston-W1 fold — Story 2-3a AC4 sources lastSavedAt from
 * `result.updatedAt`, not `meta.serverTime`).
 */
import { HttpResponse, http } from 'msw'
import type { components } from '@/lib/api/client'

type EnvelopeMeta = { serverTime: string }
type Envelope<T> = { data: T; meta: EnvelopeMeta }

type SetPersonaResult = components['schemas']['SetPersonaResult']
type CreateCenterResult = components['schemas']['CreateCenterResult']
type OnboardingProgressResult =
  components['schemas']['OnboardingProgressResult']
type PutOnboardingProgressResult =
  components['schemas']['PutOnboardingProgressResult']

const FIXED_SERVER_TIME = '2026-07-08T14:23:45.123Z'

export const defaultProgress: OnboardingProgressResult = {
  currentStep: 'persona',
  payload: null,
  updatedAt: null,
  persona: null,
}

export const defaultCreateCenterResult: CreateCenterResult = {
  id: '11111111-2222-3333-4444-555555555599',
  name: 'Saigon English Center',
  shortCode: 'saigon-english-center',
  // eslint-disable-next-line no-restricted-syntax -- brand-color wire format (FU-2-3a-C)
  brandColor: '#1e3a8a',
  logoUrl: null,
  timezone: 'Asia/Ho_Chi_Minh',
  role: 'owner',
  accessToken: 'fresh.jwt.with-center-claim',
  expiresAt: '2026-07-08T14:38:45.123Z',
}

export const onboardingHandlers = [
  http.get('/api/onboarding/progress', () =>
    HttpResponse.json<Envelope<OnboardingProgressResult>>({
      data: defaultProgress,
      meta: { serverTime: FIXED_SERVER_TIME },
    }),
  ),

  http.post('/api/onboarding/persona', async ({ request }) => {
    const body = (await request.json()) as { persona: string }
    const result: SetPersonaResult = {
      persona: body.persona as SetPersonaResult['persona'],
    }
    return HttpResponse.json<Envelope<SetPersonaResult>>({
      data: result,
      meta: { serverTime: FIXED_SERVER_TIME },
    })
  }),

  http.put('/api/onboarding/progress', async ({ request }) => {
    const body = (await request.json()) as {
      currentStep: string
      payload: components['schemas']['OnboardingProgressPayload']
    }
    const result: PutOnboardingProgressResult = {
      currentStep:
        body.currentStep as PutOnboardingProgressResult['currentStep'],
      payload: body.payload,
      updatedAt: FIXED_SERVER_TIME,
    }
    return HttpResponse.json<Envelope<PutOnboardingProgressResult>>({
      data: result,
      meta: { serverTime: FIXED_SERVER_TIME },
    })
  }),

  http.post('/api/centers', async ({ request }) => {
    const body = (await request.json()) as {
      name: string
      brandColor: string | null
      logoUrl: string | null
    }
    const result: CreateCenterResult = {
      ...defaultCreateCenterResult,
      name: body.name,
      brandColor: body.brandColor ?? defaultCreateCenterResult.brandColor,
    }
    return HttpResponse.json<Envelope<CreateCenterResult>>(
      { data: result, meta: { serverTime: FIXED_SERVER_TIME } },
      { status: 201 },
    )
  }),
]

/**
 * Error variant builders — register via `server.use(...)` per test.
 * Follows Story 1-8's error taxonomy — every 4xx/5xx carries the
 * `{error: {code, message, requestId, details?}}` envelope shape.
 */

export function errorEnvelope(
  code: string,
  message: string,
  details?: unknown,
) {
  return {
    error: {
      code,
      message,
      requestId: 'req-test-2-3a',
      details,
    },
  }
}

export const errorHandlers = {
  personaEmailVerificationRequired: () =>
    http.post('/api/onboarding/persona', () =>
      HttpResponse.json(
        errorEnvelope('EMAIL_VERIFICATION_REQUIRED', 'Email must be verified'),
        { status: 403 },
      ),
    ),

  personaRateLimited: (retryAfterSeconds = 30) =>
    http.post('/api/onboarding/persona', () =>
      HttpResponse.json(
        errorEnvelope('RATE_LIMIT_EXCEEDED', 'Too many requests'),
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        },
      ),
    ),

  personaInternalError: () =>
    http.post('/api/onboarding/persona', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),

  centerAlreadyHasCenter: (
    centerName = 'Existing Center',
    shortCode = 'existing-center',
  ) =>
    http.post('/api/centers', () =>
      HttpResponse.json(
        errorEnvelope('USER_ALREADY_HAS_CENTER', 'Already has center', {
          centerName,
          shortCode,
        }),
        { status: 409 },
      ),
    ),

  centerValidationError: (field = 'name', message = 'invalid') =>
    http.post('/api/centers', () =>
      HttpResponse.json(
        errorEnvelope('VALIDATION_ERROR', 'Invalid payload', [
          { field, message },
        ]),
        { status: 422 },
      ),
    ),

  centerEmailVerificationRequired: () =>
    http.post('/api/centers', () =>
      HttpResponse.json(
        errorEnvelope('EMAIL_VERIFICATION_REQUIRED', 'Email must be verified'),
        { status: 403 },
      ),
    ),

  centerRateLimited: (retryAfterSeconds = 45) =>
    http.post('/api/centers', () =>
      HttpResponse.json(
        errorEnvelope('RATE_LIMIT_EXCEEDED', 'Too many requests'),
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        },
      ),
    ),

  centerInternalError: () =>
    http.post('/api/centers', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),

  progressInternalError: () =>
    http.get('/api/onboarding/progress', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),

  progressWithPersona: (
    persona: 'operator' | 'founder' | 'solo_teacher' | null,
    currentStep: OnboardingProgressResult['currentStep'],
  ) =>
    http.get('/api/onboarding/progress', () =>
      HttpResponse.json<Envelope<OnboardingProgressResult>>({
        data: {
          persona,
          currentStep,
          payload: null,
          updatedAt: FIXED_SERVER_TIME,
        },
        meta: { serverTime: FIXED_SERVER_TIME },
      }),
    ),
}
