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
import {
  mockTemplateList,
  mockSpawnSuccess,
  retryAfterValue,
  type RetryAfterVariant,
} from './fixtures'

type EnvelopeMeta = { serverTime: string }
type Envelope<T> = { data: T; meta: EnvelopeMeta }

type SetPersonaResult = components['schemas']['SetPersonaResult']
type CreateCenterResult = components['schemas']['CreateCenterResult']
type OnboardingProgressResult =
  components['schemas']['OnboardingProgressResult']
type PutOnboardingProgressResult =
  components['schemas']['PutOnboardingProgressResult']
type ListTemplatesResult = components['schemas']['ListTemplatesResult']
type SpawnResult = components['schemas']['SpawnResult']
type SpawnRequest = components['schemas']['SpawnRequest']

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

  // Story 2-3b default GET /api/templates — 5 system seeds per Story 2.2 AC1b.
  http.get('/api/templates', () =>
    HttpResponse.json<Envelope<ListTemplatesResult>>({
      data: mockTemplateList(),
      meta: { serverTime: FIXED_SERVER_TIME },
    }),
  ),

  // Story 2-3b default POST /api/templates/{id}/spawn — Operator persona +
  // owner@classlite.example caller (echoes payload, derives assignment reason
  // per Winston-W4 / Murat-B3 wire contract via mockSpawnSuccess).
  http.post('/api/templates/:id/spawn', async ({ request }) => {
    const body = (await request.json()) as SpawnRequest
    const result: SpawnResult = mockSpawnSuccess({
      payload: body.classes,
      persona: 'operator',
      callerEmail: 'owner@classlite.example',
    })
    return HttpResponse.json<Envelope<SpawnResult>>(
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

  // Story 2-3c Task 3.4 — Save-and-finish-later flush contract tests
  // (Murat-S3 3-sub-test × 3 pages). The try/finally in the affordance
  // handler must guarantee navigate to /dashboard on ANY 5xx / 429 / network
  // failure — user is EXITING, so a stalled auto-save must not orphan them.

  putProgressInternalError: () =>
    http.put('/api/onboarding/progress', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),

  putProgressRateLimited: (retryAfterSeconds = 12) =>
    http.put('/api/onboarding/progress', () =>
      HttpResponse.json(
        errorEnvelope('RATE_LIMIT_EXCEEDED', 'Too many requests'),
        {
          status: 429,
          headers: { 'Retry-After': String(retryAfterSeconds) },
        },
      ),
    ),

  progressWithPersona: (
    persona: 'operator' | 'founder' | 'solo_teacher' | null,
    currentStep: OnboardingProgressResult['currentStep'],
    payload: OnboardingProgressResult['payload'] = null,
  ) =>
    http.get('/api/onboarding/progress', () =>
      HttpResponse.json<Envelope<OnboardingProgressResult>>({
        data: {
          persona,
          currentStep,
          payload,
          updatedAt: FIXED_SERVER_TIME,
        },
        meta: { serverTime: FIXED_SERVER_TIME },
      }),
    ),

  // --- Story 2-3b: GET /api/templates variants (Murat-B1 fold) ---

  templatesSeedIncomplete: () =>
    http.get('/api/templates', () =>
      HttpResponse.json(
        errorEnvelope('SEED_INCOMPLETE', 'Seed migration incomplete'),
        { status: 500 },
      ),
    ),

  templatesInternalError: () =>
    http.get('/api/templates', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),

  // R1-C3-P14 — `templatesEmailVerificationRequired` + `templatesCenterRequired`
  // deleted. GET /api/templates is architecturally pre-guarded by
  // OnboardingLayout's redirect chain (unverified users bounce to
  // /verify-email; center-less users bounce to /setup/center) — neither
  // 403 branch is reachable from the wizard. Add back if a consumer
  // materializes.

  // --- Story 2-3b: POST /api/templates/{id}/spawn variants ---

  spawnTemplateNotFound: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('TEMPLATE_NOT_FOUND', 'Template not accessible'),
        { status: 404 },
      ),
    ),

  spawnValidationError: (
    classIndex: number,
    field: string,
    code: string = '',
    message: string = 'invalid',
  ) =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('VALIDATION_ERROR', 'Invalid spawn payload', [
          {
            field: `classes[${classIndex}].${field}`,
            message,
            code,
          },
        ]),
        { status: 422 },
      ),
    ),

  spawnInvalidTeacherEmail: (classIndex: number) =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('VALIDATION_ERROR', 'Invalid teacher email', [
          {
            field: `classes[${classIndex}].teacherEmail`,
            message: 'Not a valid email address',
            code: 'INVALID_TEACHER_EMAIL',
          },
        ]),
        { status: 422 },
      ),
    ),

  spawnSelfInviteBlocked: (classIndex: number) =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('VALIDATION_ERROR', 'Cannot invite yourself', [
          {
            field: `classes[${classIndex}].teacherEmail`,
            message: 'Cannot invite yourself',
            code: 'SELF_INVITE_BLOCKED',
          },
        ]),
        { status: 422 },
      ),
    ),

  spawnEmailVerificationRequired: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope(
          'EMAIL_VERIFICATION_REQUIRED',
          'Email must be verified',
        ),
        { status: 403 },
      ),
    ),

  spawnCenterRequired: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('CENTER_REQUIRED', 'Center not created yet'),
        { status: 403 },
      ),
    ),

  spawnInvalidTenantClaim: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('INVALID_TENANT_CLAIM', 'Tenant claim invalid'),
        { status: 403 },
      ),
    ),

  spawnForbidden: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(errorEnvelope('FORBIDDEN', 'Forbidden'), {
        status: 403,
      }),
    ),

  /**
   * 429 variant with configurable Retry-After (Murat-B2 4-sub-test fold).
   * variant='short'    → Retry-After: 12
   * variant='zero'     → Retry-After: 0
   * variant='missing'  → NO Retry-After header
   * variant='malformed'→ Retry-After: abc
   */
  spawnRateLimited: (variant: RetryAfterVariant = 'short') => {
    const value = retryAfterValue(variant)
    const headers: HeadersInit = value !== null ? { 'Retry-After': value } : {}
    return http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(
        errorEnvelope('RATE_LIMIT_EXCEEDED', 'Too many spawn requests'),
        { status: 429, headers },
      ),
    )
  },

  spawnInternalError: () =>
    http.post('/api/templates/:id/spawn', () =>
      HttpResponse.json(errorEnvelope('INTERNAL_ERROR', 'Boom'), {
        status: 500,
      }),
    ),
}

// R1-C3-P15 — `templatesListHandler` + `spawnSuccessHandler` standalone exports
// deleted. They were dead code — literal duplicates of the array-inline
// entries in `onboardingHandlers` above. The canonical form is the array;
// per-test overrides register via `server.use(spawnSuccessAs(...))` below or
// via an errorHandlers.* variant.

/**
 * Persona-parameterized spawn success — for AC7 Founder auto-assign tests
 * and Solo Teacher (Solo returns `explicit_self` per Winston-W4 Solo rule).
 */
export function spawnSuccessAs(
  persona: 'operator' | 'founder' | 'solo_teacher' | null,
  callerEmail: string,
  existingMembers: ReadonlySet<string> = new Set(),
) {
  return http.post(
    '/api/templates/:id/spawn',
    async ({ request }) => {
      const body = (await request.json()) as SpawnRequest
      const result: SpawnResult = mockSpawnSuccess({
        payload: body.classes,
        persona,
        callerEmail,
        existingMembers,
      })
      return HttpResponse.json<Envelope<SpawnResult>>(
        { data: result, meta: { serverTime: FIXED_SERVER_TIME } },
        { status: 201 },
      )
    },
  )
}
