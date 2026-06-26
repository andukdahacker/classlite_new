---
name: msw-handler-catalog-auth
description: MSW v2 handler stubs for the 6 auth endpoints (Stories 1.4 + 1.5) — drop-in for Story 1.8/1.9a/1.9b/1.9c/1.9d component tests
authoritative_source: classlite-api/api.yaml#paths
target_stories: ['1-8-auth-ui-registration-and-login-screens', '1-9a-email-verification-ui', '1-9b-password-reset-ui', '1-9c-invite-acceptance-ui', '1-9d-auth-error-and-recovery-states']
created: 2026-06-06
created_by: Murat (TEA)
test_seam: HTTP boundary (TEST-FE-1)
last_updated: 2026-06-26 (Story 1-9b — consumer added. MSW response constants extracted into MSW_FORGOT_PASSWORD_DEFAULT + MSW_RESET_PASSWORD_DEFAULT with satisfies-typecheck against the openapi-generated ForgotPasswordResult / ResetPasswordResult schemas.)
---

# MSW Handler Catalog — Auth endpoints (Stories 1.4 + 1.5)

This catalog is the canonical MSW handler contract for the six auth
endpoints (`/register`, `/login`, `/refresh`, `/logout`,
`/forgot-password`, `/reset-password`). Story 1.8 (login/registration UI),
1.9a (verify-email), 1.9b (password reset), 1.9c (invite acceptance), and
1.9d (auth error/recovery states) all copy from these defaults into
`src/test/mocks/handlers.ts`. The catalog sits in the test-artifacts tree
so backend changes to the envelope shape update the contract atomically
— frontend devs ALWAYS read from here before adding a fresh interceptor.

## Change Log

| Date | Change |
|---|---|
| 2026-06-26 | Consumer added: Story 1-9b-password-reset-ui. forgot-password + reset-password sections (already documented from Story 1-5) referenced verbatim. MSW response constants extracted into `MSW_FORGOT_PASSWORD_DEFAULT` + `MSW_RESET_PASSWORD_DEFAULT` with `satisfies` typecheck so an openapi-codegen change that evolves the response shape fails to compile and a human reads the diff. |
| 2026-06-25 | Appended verify-email + resend-verification + verify-status sections (Story 1-9a consumer). Sourced verbatim from api.yaml lines 74–157 + 543–572. |
| 2026-06-25 | Renamed `msw-handler-catalog-1-5.md` → `msw-handler-catalog-auth.md`; appended `POST /api/auth/register` section (Story 1.8 consumer); broadened `target_stories` to all of 1-9a..d. Murat #4 amendment via Story 1-8 party-mode review. |
| 2026-06-06 | Initial catalog covering 5 Story 1.5 endpoints. |

## Why MSW, not vi.mock(useQuery)?

Per `docs/project-context.md` TEST-FE-1 (single mock seam at the HTTP
boundary). Component tests render through a real `QueryClient` + real
Zustand stores; only the network is faked. Mocking `useQuery` directly is
banned — it bypasses cache invalidation, stale-time logic, and the
loading→data state transition, which are the exact behaviors auth UI
needs to test.

## Setup snippet (Story 1.8/1.9b will land this verbatim)

```typescript
// src/test/mocks/handlers.ts
import { http, HttpResponse } from 'msw';
import type { components } from '@/lib/api/client'; // generated types

const API = 'http://localhost:8080'; // or env-driven base

export const handlers = [
  // ... handlers from this catalog go here
];
```

```typescript
// src/test/setup.ts
import { setupServer } from 'msw/node';
import { handlers } from './mocks/handlers';
import { afterAll, afterEach, beforeAll } from 'vitest';

export const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

> `onUnhandledRequest: 'error'` is mandatory. Silent passthrough on a
> missing handler hides a contract drift between front and back.

## Common envelope types

```typescript
type Envelope<T> = { data: T };
type ErrorEnvelope = {
  error: {
    code: string;          // UPPER_SNAKE_CASE
    message: string;
    requestId: string;
    details: unknown | null;
  };
};

type UserSummary = {
  id: string;
  email: string;
  fullName: string;
  emailVerified: boolean;
};
```

---

## POST /api/auth/register

### Happy path — `201 Created`

```typescript
http.post(`${API}/api/auth/register`, async ({ request }) => {
  const body = (await request.json()) as { email: string; password: string; fullName: string };
  return HttpResponse.json<Envelope<{ user: UserSummary; verifyPollId: string; emailDelivery: 'sent' | 'delayed' | 'failed' }>>(
    {
      data: {
        user: {
          id: '00000000-0000-0000-0000-000000msw01',
          email: body.email,
          fullName: body.fullName,
          emailVerified: false,
        },
        verifyPollId: '00000000-0000-0000-0000-poll00000001',
        emailDelivery: 'sent',
      },
    },
    { status: 201 }
  );
});
```

### Variants

| Variant                       | Status | Code                           | Notes |
| ----------------------------- | ------ | ------------------------------ | --- |
| Duplicate email               | 409   | `EMAIL_ALREADY_REGISTERED`      | Body envelope is the same regardless of whether the prior account is verified — anti-enumeration (api.yaml line 44) |
| Validation failure            | 422   | `VALIDATION_ERROR`              | `details: [{field, message}]` array. Story 1.8 iterates and calls `setError(field, ...)` per field |
| Per-IP rate limit             | 429   | `RATE_LIMIT_EXCEEDED`           | Token bucket — burst 5, replenishment 1/2min |
| Email delivery failed         | 201   | (envelope `emailDelivery: 'failed'`) | Happy 201, but the body signals the verification email send was rejected. Story 1.8 must surface a non-blocking toast prompting "Resend" on the next screen |

```typescript
// 409 EMAIL_ALREADY_REGISTERED variant
http.post(`${API}/api/auth/register`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'EMAIL_ALREADY_REGISTERED', message: 'Email already registered', requestId: 'msw', details: null } },
    { status: 409 }
  )
);

// 422 VALIDATION_ERROR with per-field details
http.post(`${API}/api/auth/register`, () =>
  HttpResponse.json<ErrorEnvelope>(
    {
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        requestId: 'msw',
        details: [
          { field: 'password', message: 'password must be at least 8 characters' },
        ],
      },
    },
    { status: 422 }
  )
);
```

> The `emailDelivery: 'failed'` case is the most easily missed branch in
> Story 1.8 tests — backend deliberately returns 201 (registration
> succeeded; the user exists, just no verification email went out) and
> the frontend renders a soft warning. Tests covering "happy path" MUST
> additionally cover the `emailDelivery: 'failed'` branch.

---

## POST /api/auth/login

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/login`, async ({ request }) => {
  const body = (await request.json()) as { email: string; password: string; rememberMe?: boolean };
  return HttpResponse.json<Envelope<{ accessToken: string; user: UserSummary }>>(
    {
      data: {
        accessToken: 'msw.jwt.signature',
        user: {
          id: 'msw-user-uuid',
          email: body.email,
          fullName: 'MSW Test User',
          emailVerified: true,
        },
      },
    },
    {
      status: 200,
      headers: {
        // refresh cookie shape mirrors the real server (manual header to keep the leading dot)
        'Set-Cookie':
          'refresh_token=msw-refresh-token; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
      },
    }
  );
});
```

### Variants

| Variant                       | Status | Code                           | Notes |
| ----------------------------- | ------ | ------------------------------ | --- |
| Wrong password / unknown email | 401   | `INVALID_CREDENTIALS`           | Body envelope identical to "wrong password" — verify the UI does not branch on the error code copy |
| Validation failure            | 422   | `VALIDATION_ERROR`              | `details` contains `[{field, message}]` array |
| Rate-limit exceeded           | 429   | `RATE_LIMIT_EXCEEDED`           | Must include `Retry-After` header |
| Account locked                | 429   | `ACCOUNT_LOCKED`                | Must include `Retry-After` header. Message includes minutes-remaining placeholder |
| Origin not allowed            | 403   | `ORIGIN_NOT_ALLOWED`            | Pre-handler reject; UI shouldn't normally hit this |

```typescript
// 429 ACCOUNT_LOCKED handler
http.post(`${API}/api/auth/login`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again in 15 minute(s).', requestId: 'msw', details: null } },
    { status: 429, headers: { 'Retry-After': '900' } }
  )
);
```

---

## POST /api/auth/refresh

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/refresh`, () =>
  HttpResponse.json<Envelope<{ accessToken: string; user: UserSummary }>>(
    {
      data: {
        accessToken: 'msw.refreshed.jwt',
        user: { id: 'msw-user-uuid', email: 'msw@example.com', fullName: 'MSW', emailVerified: true },
      },
    },
    {
      status: 200,
      headers: {
        'Set-Cookie': 'refresh_token=msw-rotated-token; Path=/; Max-Age=604800; HttpOnly; SameSite=Lax',
      },
    }
  )
);
```

### Variants

| Variant               | Status | Code                          | Notes |
| --------------------- | ------ | ----------------------------- | --- |
| Bogus / unknown token | 401   | `REFRESH_TOKEN_INVALID`        | UI redirects to /login |
| Family revoked (reuse) | 401   | `REFRESH_TOKEN_REUSE_DETECTED` | UI clears all client state + redirects to /login + shows the "session ended for security" toast |
| Cookie missing        | 401   | `REFRESH_TOKEN_INVALID`        | The client request had no cookie at all |

> `TS-5` rule from project-context: 401 handling is OWNED by the fetch
> layer (`query-client.ts`), not by individual components. The MSW
> handlers above DO emit a JSON body, but the fetch wrapper is
> responsible for choosing whether to retry the request or redirect. UI
> components don't see the 401 path.

---

## POST /api/auth/logout

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/logout`, () =>
  HttpResponse.json<Envelope<{ loggedOut: boolean }>>(
    { data: { loggedOut: true } },
    {
      status: 200,
      headers: {
        // clearing cookie
        'Set-Cookie': 'refresh_token=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax',
      },
    }
  )
);
```

> Logout is **idempotent at the network level** — the same `{loggedOut: true}`
> body is returned regardless of whether the cookie was present, valid, or
> already-revoked. Component tests must NOT assert different bodies for
> different states.

---

## POST /api/auth/forgot-password

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/forgot-password`, async ({ request }) => {
  const body = (await request.json()) as { email: string };
  // Anti-enumeration: ALWAYS 200 with the same body shape, regardless of
  // whether the email is known/verified/unknown. The component test for
  // the forgot-password screen must NOT branch on a "known vs unknown"
  // signal — there isn't one.
  return HttpResponse.json<Envelope<{ sent: boolean }>>(
    { data: { sent: true } },
    { status: 200 }
  );
});
```

### Variants

| Variant            | Status | Code                | Notes |
| ------------------ | ------ | ------------------- | --- |
| Bad email format   | 422   | `VALIDATION_ERROR`   | `details: [{field: 'email', message: 'invalid email format'}]` |
| Per-IP rate limit  | 429   | `RATE_LIMIT_EXCEEDED` | `Retry-After` header |
| Per-email rate limit | 429 | `RATE_LIMIT_EXCEEDED` | Same envelope; the test cannot distinguish per-IP vs per-email |

---

## POST /api/auth/reset-password

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/reset-password`, async ({ request }) => {
  const body = (await request.json()) as { token: string; newPassword: string };
  return HttpResponse.json<Envelope<{ reset: boolean }>>(
    { data: { reset: true } },
    { status: 200 }
  );
});
```

### Variants

| Variant                | Status | Code                    | Notes |
| ---------------------- | ------ | ----------------------- | --- |
| Token does not exist   | 404   | `RESET_TOKEN_INVALID`    | Unknown / never-issued token |
| Token already used     | 409   | `RESET_TOKEN_CONSUMED`   | Replay of a consumed token |
| Token expired          | 410   | `RESET_TOKEN_EXPIRED`    | 1-hour TTL elapsed |
| Password too short/long | 422  | `VALIDATION_ERROR`       | `details: [{field: 'newPassword', message: 'must be at least 8 characters'}]` |

```typescript
// 409 RESET_TOKEN_CONSUMED variant
http.post(`${API}/api/auth/reset-password`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'RESET_TOKEN_CONSUMED', message: 'This password reset link has already been used.', requestId: 'msw', details: null } },
    { status: 409 }
  )
);
```

---

## POST /api/auth/verify-email

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/verify-email`, async ({ request }) => {
  const body = (await request.json()) as { token: string };
  return HttpResponse.json<Envelope<{ verified: boolean; email: string }>>(
    {
      data: {
        verified: true,
        email: 'msw@example.com',
      },
    },
    { status: 200 }
  );
});
```

### Variants

| Variant                | Status | Code                            | Notes |
| ---------------------- | ------ | ------------------------------- | --- |
| Token does not exist   | 404    | `VERIFICATION_TOKEN_INVALID`    | Unknown / never-issued token |
| Token expired (>24h)   | 410    | `VERIFICATION_TOKEN_EXPIRED`    | Link is older than the 24h TTL and the user has not verified yet |
| Validation failure     | 422    | `VALIDATION_ERROR`              | Missing token / malformed body |

```typescript
// 410 VERIFICATION_TOKEN_EXPIRED variant
http.post(`${API}/api/auth/verify-email`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'VERIFICATION_TOKEN_EXPIRED', message: 'Verification link expired', requestId: 'msw', details: null } },
    { status: 410 }
  )
);

// 404 VERIFICATION_TOKEN_INVALID variant
http.post(`${API}/api/auth/verify-email`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'VERIFICATION_TOKEN_INVALID', message: 'Invalid verification link', requestId: 'msw', details: null } },
    { status: 404 }
  )
);
```

> The operation is **idempotent at the network level** — replaying a
> prior-issued token after the user is already verified returns 200 with
> `verified: true`. Component tests must NOT branch on a "fresh vs
> replayed" signal — there isn't one.

---

## POST /api/auth/resend-verification

### Happy path — `200 OK`

```typescript
http.post(`${API}/api/auth/resend-verification`, async ({ request }) => {
  const body = (await request.json()) as { email: string };
  // Anti-enumeration: a 200 with `verifyPollId: null` is returned when
  // the email is unknown OR already verified. Story 1-9a's UI must NOT
  // branch on null vs non-null for the success toast — same anti-
  // enumeration discipline as /forgot-password.
  return HttpResponse.json<Envelope<{ verifyPollId: string | null }>>(
    {
      data: {
        verifyPollId: '00000000-0000-0000-0000-poll00000099',
      },
    },
    { status: 200 }
  );
});
```

### Variants

| Variant                   | Status | Code                  | Notes |
| ------------------------- | ------ | --------------------- | --- |
| Email unknown / already verified | 200 | (envelope `verifyPollId: null`) | Anti-enumeration — same 200 envelope shape, but the poll ID is null because no new token was issued |
| Validation failure        | 422    | `VALIDATION_ERROR`     | Invalid email format / malformed body |
| Per-IP / per-email rate limit | 429 | `RATE_LIMIT_EXCEEDED`  | Per-IP token bucket (burst 5, 1/2 min) OR per-email bucket (1/60 s). Must include `Retry-After` header. |

```typescript
// 429 RATE_LIMIT_EXCEEDED variant (per-email)
http.post(`${API}/api/auth/resend-verification`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Please wait before requesting another email.', requestId: 'msw', details: null } },
    { status: 429, headers: { 'Retry-After': '60' } }
  )
);

// 200 anti-enumeration null variant
http.post(`${API}/api/auth/resend-verification`, () =>
  HttpResponse.json<Envelope<{ verifyPollId: string | null }>>(
    { data: { verifyPollId: null } },
    { status: 200 }
  )
);
```

---

## GET /api/auth/verify-status

### Happy path — `200 OK` with `verified: false`

```typescript
http.get(`${API}/api/auth/verify-status`, ({ request }) => {
  const url = new URL(request.url);
  const pollId = url.searchParams.get('pollId');
  return HttpResponse.json<Envelope<{ verified: boolean; email: string }>>(
    {
      data: {
        verified: false,
        email: 'msw@example.com',
      },
    },
    { status: 200 }
  );
});
```

### Variants

| Variant                          | Status | Code                | Notes |
| -------------------------------- | ------ | ------------------- | --- |
| Verified (poller terminal state) | 200    | (envelope `verified: true`) | Poller's terminal "success" branch |
| Poll ID not found / expired      | 404    | `POLL_ID_NOT_FOUND`  | Unknown, malformed, OR expired (>24h). Poller's terminal "expired" branch |

```typescript
// 200 with verified: true
http.get(`${API}/api/auth/verify-status`, () =>
  HttpResponse.json<Envelope<{ verified: boolean; email: string }>>(
    { data: { verified: true, email: 'msw@example.com' } },
    { status: 200 }
  )
);

// 404 POLL_ID_NOT_FOUND variant
http.get(`${API}/api/auth/verify-status`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'POLL_ID_NOT_FOUND', message: 'Poll ID not found, malformed, or expired', requestId: 'msw', details: null } },
    { status: 404 }
  )
);
```

> Story 1-9a's poller MUST treat the 404 path as **terminal**, NOT as a
> retry-and-hope condition. Backend has already rotated the token (24h
> TTL elapsed); subsequent polls will return the same 404. The component
> swaps to the "Verification link expired" inline state and stops the
> poller via `enabled=false`.

---

## Role-Negative Handlers (cross-cutting)

The five Story 1.5 endpoints are all PUBLIC (no `ExtractTenant` middleware
in front of them), so role-negative paths don't apply to THIS catalog.
When Epic 2 lands authenticated routes, the role-negative MSW handlers
will be:

```typescript
// 403 INSUFFICIENT_ROLE — a teacher hitting an owner-only endpoint
http.post(`${API}/api/admin/staff/invite`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'INSUFFICIENT_ROLE', message: 'insufficient role', requestId: 'msw', details: null } },
    { status: 403 }
  )
);

// 401 AUTH_USER_GONE — JWT was valid, user was deleted between issuance and now
http.get(`${API}/api/protected`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'AUTH_USER_GONE', message: 'Authentication failed.', requestId: 'msw', details: null } },
    { status: 401 }
  )
);

// 403 INVALID_TENANT_CLAIM — JWT center_id points to a center user has no membership in
http.get(`${API}/api/protected`, () =>
  HttpResponse.json<ErrorEnvelope>(
    { error: { code: 'INVALID_TENANT_CLAIM', message: 'JWT center claim does not match active membership.', requestId: 'msw', details: null } },
    { status: 403 }
  )
);
```

---

## Three-state coverage handlers (per TEST-FE-2)

Every component that fetches data needs three named test cases: loading,
success, error. The handler patterns to enable each:

### Loading state — delay the response

```typescript
import { delay } from 'msw';

http.post(`${API}/api/auth/login`, async () => {
  await delay(500); // long enough for the skeleton to render
  return HttpResponse.json({ data: { /* ... */ } });
});
```

### Error state — return a network error (no body)

```typescript
http.post(`${API}/api/auth/login`, () => HttpResponse.error());
```

> `HttpResponse.error()` simulates a TCP-level failure, NOT a 5xx with a
> body. Use it for "network down" scenarios. Use a real 500 response
> when you specifically want to test the 500 envelope rendering.

---

## Per-test handler override pattern

Each component test that needs a different response than the default
MUST override at the test level — never mutate the default `handlers`
array.

```typescript
import { server } from '@/test/setup';

test('shows ACCOUNT_LOCKED message when API returns 429', async () => {
  server.use(
    http.post(`${API}/api/auth/login`, () =>
      HttpResponse.json(
        { error: { code: 'ACCOUNT_LOCKED', message: 'Too many failed attempts. Try again in 15 minute(s).', requestId: 't', details: null } },
        { status: 429, headers: { 'Retry-After': '900' } }
      )
    )
  );

  renderWithQuery(<LoginForm />);
  // submit form …
  expect(await screen.findByRole('alert')).toHaveTextContent(/15 minute/i);
});
```

`afterEach(() => server.resetHandlers())` in setup.ts wipes the override.

---

## i18n test pattern (TEST-FE-4)

These auth screens are bilingual. Component tests must run with BOTH
locales and assert keys via `i18n.t()`, never hardcoded English:

```typescript
test('login button label resolves in en', () => {
  renderWithI18n(<LoginForm />, { locale: 'en' });
  expect(screen.getByRole('button', { name: i18n.t('auth.login.submit') })).toBeInTheDocument();
});

test('login button label resolves in vi', () => {
  renderWithI18n(<LoginForm />, { locale: 'vi' });
  expect(screen.getByRole('button', { name: i18n.t('auth.login.submit') })).toBeInTheDocument();
});

test('all auth keys exist in both locales', () => {
  const keys = ['auth.login.submit', 'auth.login.email', 'auth.login.password', 'auth.login.rememberMe',
                'auth.forgotPassword.submit', 'auth.resetPassword.submit'];
  keys.forEach((key) => {
    expect(i18n.exists(key, { lng: 'en' })).toBe(true);
    expect(i18n.exists(key, { lng: 'vi' })).toBe(true);
  });
});
```

---

## Accessibility test pattern (TEST-FE-5)

```typescript
import { axe } from 'vitest-axe';

test('login form has no a11y violations', async () => {
  const { container } = renderWithQuery(<LoginForm />);
  expect(await axe(container)).toHaveNoViolations();
});

test('email field is reachable via the i18n-resolved label', () => {
  renderWithQuery(<LoginForm />);
  expect(
    screen.getByRole('textbox', { name: i18n.t('auth.login.email') })
  ).toBeInTheDocument();
});
```

---

## How to update this catalog

If `classlite-api/api.yaml` changes (envelope shape, new error code, new
endpoint), update this file in the SAME commit. The author of the
backend change is responsible — the frontend story that depends on the
catalog should NOT discover drift via failing component tests.

Update workflow:

1. Edit `api.yaml`
2. Update the relevant section here
3. Bump `created` to the change date and add a `last_updated` line
4. Run `bash scripts/codegen.sh` to regenerate the TS types
5. Commit both changes atomically

---

## References

- `docs/project-context.md` — TEST-FE-1 (MSW seam), TEST-FE-2 (three-state coverage), TEST-FE-4 (i18n), TEST-FE-5 (a11y)
- `classlite-api/api.yaml` — authoritative endpoint specs (1.5 endpoints under `/api/auth/`)
- `_bmad-output/implementation-artifacts/1-5-login-session-management-and-password-reset-api.md` — Story 1.5 ACs that drive these handlers
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Stories 1.8 and 1.9b are the consumers of this catalog
