/**
 * profileKeys — query-key factory for the self-profile feature (TS-3).
 *
 * `me()` is the single self-profile cache slice backing GET /api/users/me.
 * Distinct namespace from the settings/center-profile keys (that is a
 * different entity — the Owner-only CENTER profile).
 */
export const profileKeys = {
  all: ['profile'] as const,
  me: () => [...profileKeys.all, 'me'] as const,
} as const
