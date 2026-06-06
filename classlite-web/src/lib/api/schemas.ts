import { makeApi, Zodios, type ZodiosOptions } from "@zodios/core";
import { z } from "zod";

const RegisterRequest = z
  .object({
    email: z.string().max(320).email(),
    password: z.string().min(8).max(72),
    fullName: z.string().min(1).max(200),
  })
  .passthrough();
const UserSummary = z
  .object({
    id: z.string().uuid(),
    email: z.string().email(),
    fullName: z.string(),
    emailVerified: z.boolean(),
  })
  .passthrough();
const RegisterResult = z
  .object({
    user: UserSummary,
    verifyPollId: z.string().uuid(),
    emailDelivery: z.enum(["sent", "delayed", "failed"]),
  })
  .passthrough();
const EnvelopeRegisterResult = z.object({ data: RegisterResult }).passthrough();
const FieldError = z
  .object({ field: z.string(), message: z.string() })
  .passthrough();
const ErrorBody = z
  .object({
    code: z.string(),
    message: z.string(),
    requestId: z.string(),
    details: z.union([z.null(), z.array(FieldError)]),
  })
  .passthrough();
const ErrorEnvelope = z.object({ error: ErrorBody }).passthrough();
const VerifyEmailRequest = z.object({ token: z.string().min(1) }).passthrough();
const VerifyEmailResult = z
  .object({ verified: z.boolean(), email: z.string().email() })
  .passthrough();
const EnvelopeVerifyEmailResult = z
  .object({ data: VerifyEmailResult })
  .passthrough();
const ResendVerificationRequest = z
  .object({ email: z.string().email() })
  .passthrough();
const ResendResult = z
  .object({ verifyPollId: z.string().uuid().nullable() })
  .passthrough();
const EnvelopeResendResult = z.object({ data: ResendResult }).passthrough();
const LoginRequest = z
  .object({
    email: z.string().email(),
    password: z.string().min(1),
    rememberMe: z.boolean().optional().default(false),
  })
  .passthrough();
const LoginResult = z
  .object({ accessToken: z.string(), user: UserSummary })
  .passthrough();
const EnvelopeLoginResult = z.object({ data: LoginResult }).passthrough();
const LogoutResult = z.object({ loggedOut: z.boolean() }).passthrough();
const EnvelopeLogoutResult = z.object({ data: LogoutResult }).passthrough();
const ForgotPasswordRequest = z
  .object({ email: z.string().email() })
  .passthrough();
const ForgotPasswordResult = z.object({ sent: z.boolean() }).passthrough();
const EnvelopeForgotPasswordResult = z
  .object({ data: ForgotPasswordResult })
  .passthrough();
const ResetPasswordRequest = z
  .object({ token: z.string().min(1), newPassword: z.string().min(8).max(72) })
  .passthrough();
const ResetPasswordResult = z.object({ reset: z.boolean() }).passthrough();
const EnvelopeResetPasswordResult = z
  .object({ data: ResetPasswordResult })
  .passthrough();
const VerifyStatusResult = z
  .object({ verified: z.boolean(), email: z.string().email() })
  .passthrough();
const EnvelopeVerifyStatusResult = z
  .object({ data: VerifyStatusResult })
  .passthrough();

export const schemas = {
  RegisterRequest,
  UserSummary,
  RegisterResult,
  EnvelopeRegisterResult,
  FieldError,
  ErrorBody,
  ErrorEnvelope,
  VerifyEmailRequest,
  VerifyEmailResult,
  EnvelopeVerifyEmailResult,
  ResendVerificationRequest,
  ResendResult,
  EnvelopeResendResult,
  LoginRequest,
  LoginResult,
  EnvelopeLoginResult,
  LogoutResult,
  EnvelopeLogoutResult,
  ForgotPasswordRequest,
  ForgotPasswordResult,
  EnvelopeForgotPasswordResult,
  ResetPasswordRequest,
  ResetPasswordResult,
  EnvelopeResetPasswordResult,
  VerifyStatusResult,
  EnvelopeVerifyStatusResult,
};

const endpoints = makeApi([
  {
    method: "post",
    path: "/api/auth/forgot-password",
    alias: "forgotPassword",
    description: `Sends a reset email (1 hour TTL) when the email is known and
verified. Returns the same 200 envelope for unknown / unverified
emails — anti-enumeration. All 200 responses are padded to ≥ 200ms.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: z.object({ email: z.string().email() }).passthrough(),
      },
    ],
    response: EnvelopeForgotPasswordResult,
    errors: [
      {
        status: 422,
        description: `Invalid email format or malformed body`,
        schema: ErrorEnvelope,
      },
      {
        status: 429,
        description: `Per-IP (5 / 2min) or per-email (3 / 60s) rate-limit exceeded.`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/login",
    alias: "login",
    description: `Verifies credentials and issues a 15-minute access token + a refresh
token (7d default, 30d with rememberMe). The refresh token is set as
an httpOnly cookie (all four cookie attributes per AC10); the
response body NEVER includes the refresh token. After 5 failed
attempts within 10 minutes, the account is locked for 15 minutes —
subsequent attempts (even with the correct password) return 429
ACCOUNT_LOCKED with a Retry-After header.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: LoginRequest,
      },
    ],
    response: EnvelopeLoginResult,
    errors: [
      {
        status: 401,
        description: `INVALID_CREDENTIALS — wrong email or password (indistinguishable from unknown email).`,
        schema: ErrorEnvelope,
      },
      {
        status: 422,
        description: `Validation failure or malformed JSON body`,
        schema: ErrorEnvelope,
      },
      {
        status: 429,
        description: `ACCOUNT_LOCKED (5 failed attempts in 10 min, locked 15 min) OR per-IP RATE_LIMIT_EXCEEDED.`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/logout",
    alias: "logout",
    description: `Hard-deletes the matching refresh_tokens row and emits a clearing
Set-Cookie. Idempotent — unknown / missing / already-revoked
cookies still return 200.
`,
    requestFormat: "json",
    response: EnvelopeLogoutResult,
  },
  {
    method: "post",
    path: "/api/auth/refresh",
    alias: "refreshToken",
    description: `Atomically DELETEs the presented refresh token row and INSERTs a
fresh one in the same family. Reuse of a rotated-out token triggers
family revocation (every refresh in the family is deleted), and the
response is 401 REFRESH_TOKEN_REUSE_DETECTED.
`,
    requestFormat: "json",
    response: EnvelopeLoginResult,
    errors: [
      {
        status: 401,
        description: `REFRESH_TOKEN_INVALID (no row + no family) or REFRESH_TOKEN_REUSE_DETECTED (family revoked).`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/register",
    alias: "registerUser",
    description: `Creates a new user account and sends a verification email. The
&#x60;emailDelivery&#x60; field in the response is always present:
&#x60;&quot;sent&quot;&#x60; when the verification email was enqueued cleanly,
&#x60;&quot;failed&quot;&#x60; when the retry queue rejected the job (buffer full — no
async retry will occur; the client should prompt the user to hit
Resend Verification). &#x60;&quot;delayed&quot;&#x60; is reserved for future use cases.
Returns 409 EMAIL_ALREADY_REGISTERED for any duplicate regardless of
verification status (anti-enumeration).
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: RegisterRequest,
      },
    ],
    response: EnvelopeRegisterResult,
    errors: [
      {
        status: 409,
        description: `Email already registered (ambiguous — does not reveal verification status)`,
        schema: ErrorEnvelope,
      },
      {
        status: 422,
        description: `Validation failure or malformed JSON body`,
        schema: ErrorEnvelope,
      },
      {
        status: 429,
        description: `Per-IP rate limit exceeded (token bucket — burst 5, replenishment 1 every 2 min)`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/resend-verification",
    alias: "resendVerification",
    description: `Rotates the user&#x27;s verification token (invalidating any prior
unconsumed tokens) and sends a new email. Returns 200 with
&#x60;verifyPollId: null&#x60; when the email is unknown OR already verified,
to prevent enumeration. All 200 responses are padded to ≥ 200 ms.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: z.object({ email: z.string().email() }).passthrough(),
      },
    ],
    response: EnvelopeResendResult,
    errors: [
      {
        status: 422,
        description: `Invalid email format or malformed JSON body`,
        schema: ErrorEnvelope,
      },
      {
        status: 429,
        description: `Rate limit exceeded — either the per-IP token bucket (burst 5, 1
token / 2 min) or the per-email bucket (1 token / 60 s).
`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/reset-password",
    alias: "resetPassword",
    description: `Consumes the reset token, updates the password, DELETEs every
refresh_tokens row for the user (force re-login everywhere), and
clears login_attempts. Replaying a consumed token returns 409
RESET_TOKEN_CONSUMED; an expired token returns 410
RESET_TOKEN_EXPIRED.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: ResetPasswordRequest,
      },
    ],
    response: EnvelopeResetPasswordResult,
    errors: [
      {
        status: 404,
        description: `RESET_TOKEN_INVALID — token does not exist.`,
        schema: ErrorEnvelope,
      },
      {
        status: 409,
        description: `RESET_TOKEN_CONSUMED — token was already used.`,
        schema: ErrorEnvelope,
      },
      {
        status: 410,
        description: `RESET_TOKEN_EXPIRED — token TTL elapsed.`,
        schema: ErrorEnvelope,
      },
      {
        status: 422,
        description: `Validation failure (password length) or malformed body.`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "post",
    path: "/api/auth/verify-email",
    alias: "verifyEmail",
    description: `Consumes the verification token, sets &#x60;users.email_verified &#x3D; true&#x60;,
and invalidates any other unconsumed tokens for the same user. The
operation is idempotent — replaying any prior-issued token after the
user is verified also returns 200.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "body",
        type: "Body",
        schema: z.object({ token: z.string().min(1) }).passthrough(),
      },
    ],
    response: EnvelopeVerifyEmailResult,
    errors: [
      {
        status: 404,
        description: `Token does not exist (VERIFICATION_TOKEN_INVALID)`,
        schema: ErrorEnvelope,
      },
      {
        status: 410,
        description: `Token expired — the link is older than 24 hours and the user has
not verified yet (VERIFICATION_TOKEN_EXPIRED). Rotated-out tokens
(a newer resend has been issued) DO NOT return 410 on their own —
once the user is verified, replaying any prior-issued token
returns 200 idempotent.
`,
        schema: ErrorEnvelope,
      },
      {
        status: 422,
        description: `Validation failure (missing token) or malformed JSON body`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "get",
    path: "/api/auth/verify-status",
    alias: "verifyStatus",
    description: `Returns the user&#x27;s current &#x60;emailVerified&#x60; state given a poll ID. The
poll ID is the &#x60;email_verifications.id&#x60; of the row issued at
registration or resend. Poll IDs expire 24 hours after creation,
matching the verification token TTL. Unknown, malformed, or expired
poll IDs all return the same 404 POLL_ID_NOT_FOUND.
`,
    requestFormat: "json",
    parameters: [
      {
        name: "pollId",
        type: "Query",
        schema: z.string().uuid(),
      },
    ],
    response: EnvelopeVerifyStatusResult,
    errors: [
      {
        status: 404,
        description: `Poll ID not found, malformed, or expired (POLL_ID_NOT_FOUND)`,
        schema: ErrorEnvelope,
      },
    ],
  },
  {
    method: "get",
    path: "/health",
    alias: "healthCheck",
    description: `Returns the current health status of the API`,
    requestFormat: "json",
    response: z.object({ status: z.string() }).passthrough(),
  },
]);

export const api = new Zodios(endpoints);

export function createApiClient(baseUrl: string, options?: ZodiosOptions) {
  return new Zodios(baseUrl, endpoints, options);
}
