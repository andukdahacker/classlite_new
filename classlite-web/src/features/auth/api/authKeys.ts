/**
 * authKeys — query-key factory for the auth feature (TS-3 + FW-6).
 *
 * The `session` key is **cache-only**. The consumer (`useAuth`) subscribes
 * via `useSyncExternalStore` on the `QueryCache` channel so any
 * `setQueryData(authKeys.session(), ...)` writer (login mutation /
 * register mutation / silent-refresh coordinator / boot probe) triggers a
 * re-render in every consumer.
 *
 * The literal `['auth', 'session']` array is duplicated inside
 * `src/lib/auth-refresh.ts` (the success branch + the BroadcastChannel
 * `refresh-succeeded` listener) to avoid landing a third edge on the
 * existing `query-client` ↔ `api-fetch` ↔ `auth-refresh` import cycle —
 * adding `authKeys` would make that triadic. The duplication is locked
 * by the `authKeys.test.ts` contract assertion
 * `expect(authKeys.session()).toEqual(['auth', 'session'])` so any future
 * rename catches it.
 *
 * Mutation keys (`loginMutation` / `registerMutation`) are DISTINCT from
 * the cache key per code-review P5 (2026-06-25). `mutationCache.findAll`
 * keyed by `authKeys.session()` would otherwise return BOTH in-flight
 * mutations and a future consumer iterating the result set could not tell
 * "login attempts" from "register attempts" apart. The cache-write key
 * (`authKeys.session()`) stays shared because both mutations populate the
 * same session slot.
 */
import type { components } from '@/lib/api/client'

export type UserSummary = components['schemas']['UserSummary']

/**
 * Role — the four canonical center_members.role values.
 *
 * Wire type derives from the api.yaml LoginResult.role enum (Story 2.6
 * AC2). Duplicated here as a narrow union so consumers can type against
 * `Role` without pulling `components['schemas']['LoginResult']` in.
 * The DB CHECK constraint at `20260717120000_add_role_check_center_members`
 * enforces the same set — code + DB stay locked to the same four values.
 */
export type Role = 'owner' | 'admin' | 'teacher' | 'student'

/**
 * CenterSummary — the six-field slice of `CreateCenterResult` that lives on
 * `Session.center` (Story 2-3a AC9). Populated by `useCreateCenter.onSuccess`;
 * defined-as-null on every other Session writer so downstream `useCurrentCenter`
 * + AC8 `!= null` guards never observe `undefined`.
 */
export interface CenterSummary {
  id: string
  name: string
  shortCode: string
  brandColor: string | null
  logoUrl: string | null
  timezone: string
}

/**
 * Session — the cache shape Story 1-8 establishes for the lifetime of
 * the dashboard. `user` is the openapi-generated UserSummary verbatim;
 * `accessToken` is `null` for a registered-but-unverified user
 * (verification flow lives in Story 1.9a) AND non-null after a
 * successful login or silent refresh.
 *
 * `center` (added by Story 2-3a AC9): the summary of the caller's owned center,
 * or `null` before onboarding completes. Every session writer MUST populate
 * this — a bare `{user, accessToken}` write leaks `undefined` into the cache
 * and every consumer that guards on `session.center != null` misfires.
 *
 * IMPORTANT: `isAuthenticated` in `useAuth` is derived from
 * `user.emailVerified`, NOT from the presence of `accessToken`. A user
 * who just registered has `{user, accessToken: null}` in the cache so
 * 1.9a can read `user.fullName` to render "We sent a code to
 * {{email}}" — but downstream authenticated UI surfaces stay gated by
 * `emailVerified`.
 */
export interface Session {
  user: UserSummary
  accessToken: string | null
  center: CenterSummary | null
  /**
   * Story 2.6 (AC2). The caller's DB-resolved center_members.role at the
   * moment this cache entry was written. `null` for:
   *   - post-register / pre-onboarding state (`useRegister.onSuccess`
   *     writes `role = null` because register mints without a center)
   *   - pre-Story-2.6 sessions rehydrated via silent refresh (the
   *     backend now emits `role` on refresh, but a session already in
   *     the cache from an earlier deploy may still hold `null` until
   *     the next refresh lands)
   *
   * `useRole()` reads this field; `useRoleLoading()` distinguishes the
   * "boot probe in flight" case from the "session hydrated but role
   * hasn't landed yet" migration window (CR-2-5A-7 fold).
   *
   * Every session writer MUST populate this field explicitly. Missing
   * the assignment leaves `undefined` in the cache and `useRole` cannot
   * distinguish "unauthenticated" from "role not yet resolved" — the
   * `authKeys.test.ts` contract lock catches drift.
   */
  role: Role | null
}

export const authKeys = {
  all: ['auth'] as const,
  session: () => [...authKeys.all, 'session'] as const,
  loginMutation: () => [...authKeys.all, 'mutation', 'login'] as const,
  registerMutation: () => [...authKeys.all, 'mutation', 'register'] as const,
  /**
   * Story 1-9a — query key for the GET /api/auth/verify-status poller.
   * One key per pollId so distinct polling sessions stay isolated in the
   * QueryCache. The poller (`useVerificationPoller`) does NOT consume
   * this key via `useQuery` — `usePolling` owns the lifecycle — but the
   * key exists so future cache-inspection / devtools surface attaches
   * a stable label.
   */
  verifyStatus: (pollId: string) =>
    [...authKeys.all, 'verify-status', pollId] as const,
  /** Story 1-9a — mutation key for the resend-verification mutation. */
  resendMutation: () => [...authKeys.all, 'mutation', 'resend'] as const,
  /** Story 1-9a — mutation key for the verify-email click-through mutation. */
  verifyEmailMutation: () =>
    [...authKeys.all, 'mutation', 'verify-email'] as const,
  /** Story 1-9b — mutation key for the forgot-password (request reset link) call. */
  forgotPasswordMutation: () =>
    [...authKeys.all, 'mutation', 'forgot-password'] as const,
  /** Story 1-9b — mutation key for the reset-password (set new password) call. */
  resetPasswordMutation: () =>
    [...authKeys.all, 'mutation', 'reset-password'] as const,
  /** Story 1-9c — mutation key for the accept-invite call. */
  acceptInviteMutation: () =>
    [...authKeys.all, 'mutation', 'accept-invite'] as const,
}
