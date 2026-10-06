/**
 * useUpdateProfile — Story 9.4 PUT /api/users/me (AC6 / AC8 / D5).
 *
 * FULL-SNAPSHOT replace: the caller passes the WHOLE current profile (an
 * avatar-only or language-only edit still carries the unchanged fields), so a
 * partial PUT can never blank a field (D5). Mirrors the canonical
 * `useUpdateCenterProfile` cache-write contract:
 *   - FW-2 optimistic triple on the `profileKeys.me()` cache.
 *   - onSuccess IMPERATIVELY writes the fresh name/avatar/language into
 *     `authKeys.session()` so the sidebar pill + topbar re-render WITHOUT a
 *     refetch flicker (AC8). An empty session cache falls back to refetch.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { authKeys, type Session } from '@/features/auth/api/authKeys'
import { profileKeys } from './profileKeys'
import type { UserProfile } from './useProfile'

export type UpdateUserProfileRequest =
  components['schemas']['UpdateUserProfileRequest']

interface OptimisticContext {
  previous: UserProfile | undefined
}

export function useUpdateProfile() {
  const queryClient = useQueryClient()
  const key = profileKeys.me()

  return useMutation<
    UserProfile,
    Error,
    UpdateUserProfileRequest,
    OptimisticContext
  >({
    mutationFn: (input) =>
      apiFetch<UserProfile>('/api/users/me', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }),
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: key })
      const previous = queryClient.getQueryData<UserProfile>(key)
      if (previous) {
        queryClient.setQueryData<UserProfile>(key, {
          ...previous,
          fullName: input.fullName,
          // Keep the previously-stored avatar URL during the optimistic window:
          // input.avatarUrl may be a raw R2 object KEY (not a servable URL), which
          // would render as a broken <img src> for any reader of this cache slice.
          // onSuccess writes the server's resolved full public URL (review patch P5).
          avatarUrl: previous.avatarUrl,
          languagePref: input.languagePref,
          notificationSettings: input.notificationSettings,
        })
      }
      return { previous }
    },
    onError: (_err, _input, context) => {
      if (context?.previous) {
        queryClient.setQueryData<UserProfile>(key, context.previous)
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<UserProfile>(key, data)
      // AC8 — imperative session-cache write so the pill + topbar re-render
      // without a refetch. The UserSummary carries avatarUrl + languagePref
      // (D12), so the pill picks up a new avatar with no flicker.
      const previousSession = queryClient.getQueryData<Session>(
        authKeys.session(),
      )
      if (previousSession) {
        queryClient.setQueryData<Session>(authKeys.session(), {
          ...previousSession,
          user: {
            ...previousSession.user,
            fullName: data.fullName,
            avatarUrl: data.avatarUrl,
            languagePref: data.languagePref,
          },
        })
      } else {
        // Session cache can be empty during a silent-refresh window; refetch
        // reconciles without racing an imperative write (mirrors
        // useUpdateCenterProfile P7).
        void queryClient.refetchQueries({ queryKey: authKeys.session() })
      }
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: key })
    },
  })
}
