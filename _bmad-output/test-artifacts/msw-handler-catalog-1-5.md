---
name: msw-handler-catalog-1-5
description: MSW v2 handler stubs for the 5 Story 1.5 auth endpoints — drop-in for Story 1.8/1.9b component tests
authoritative_source: classlite-api/api.yaml#paths
target_stories: ['1-8-auth-ui-registration-and-login-screens', '1-9b-password-reset-ui']
created: 2026-06-06
created_by: Murat (TEA)
test_seam: HTTP boundary (TEST-FE-1)
---

# MSW Handler Catalog — Story 1.5 endpoints

This catalog is the canonical MSW handler contract for the five Story 1.5
endpoints (`/login`, `/refresh`, `/logout`, `/forgot-password`, `/reset-password`).
Story 1.8 (login/registration UI) and Story 1.9b (password reset UI) will
copy these handlers into their `src/test/mocks/handlers.ts`. The catalog
sits in the test-artifacts tree so backend changes to the envelope shape
update the contract atomically — frontend devs ALWAYS read from here
before adding a fresh interceptor.

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
