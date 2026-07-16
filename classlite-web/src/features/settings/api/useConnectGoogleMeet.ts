/**
 * useConnectGoogleMeet — Story 2-5c AC2 Connect flow.
 *
 * On mutate: fetch the signed Google authorize URL from the API, set a
 * `sessionStorage` marker so the callback-return handler in SettingsPage
 * knows the Owner initiated this (drive-by URL manipulation must NOT fire
 * the success toast — see AC14), then `window.location.assign` to
 * navigate the browser to Google.
 *
 * Not a "normal" mutation — success = full-page navigation, not
 * TanStack-Query cache update. Hook wires a default `onError` so authorize
 * failures (503 OAUTH_NOT_CONFIGURED, 429, 500, network) surface a toast
 * via i18n key `settings.integrations.googleMeet.connect.error`. Chunk 3
 * review 2026-07-16 fix.
 */
import { useMutation } from '@tanstack/react-query'
import { z } from 'zod'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { settingsKeys } from './settingsKeys'
import { CONNECT_IN_FLIGHT_MARKER_KEY } from './connectMarker'

export type GoogleMeetAuthorizeResult = components['schemas']['GoogleMeetAuthorizeResult']

// Chunk 3 review 2026-07-16: symmetric toast ids for connect flow.
const CONNECT_ERROR_TOAST_ID = 'settings-integration-connect-error'

// Runtime response guard so a shape drift on the API surfaces at mutate
// time (not at browser navigation).
export const googleMeetAuthorizeResponseSchema = z.object({
  authorizeUrl: z.url(),
  expiresAt: z.string().min(1),
})

// Clear the in-flight marker — used by both the onError branch and the
// assign-throw catch so a failed navigation does not leak a stale marker
// into the next drive-by return (which would spuriously fire the success
// toast). Chunk 3 review 2026-07-16 M2 + assign-safety fix.
function clearInFlightMarker(): void {
  try {
    window.sessionStorage.removeItem(CONNECT_IN_FLIGHT_MARKER_KEY)
  } catch {
    // ignore — see setItem catch below.
  }
}

export function useConnectGoogleMeet(centerId: string) {
  const { t } = useTranslation()
  return useMutation<GoogleMeetAuthorizeResult, Error, void>({
    mutationKey: settingsKeys.integration(centerId, 'google_meet'),
    mutationFn: async () => {
      const raw = await apiFetch<GoogleMeetAuthorizeResult>(
        `/api/centers/${centerId}/integrations/google-meet/authorize`,
      )
      // Guard against server/client drift — parse before consuming.
      return googleMeetAuthorizeResponseSchema.parse(raw)
    },
    onSuccess: (result) => {
      // Marker is checked by SettingsPage on callback-return so drive-by
      // URL manipulation (?status=connected without preceding Connect
      // click) does NOT fire the success toast.
      try {
        window.sessionStorage.setItem(CONNECT_IN_FLIGHT_MARKER_KEY, '1')
      } catch {
        // sessionStorage can throw in some browser private-modes — the
        // marker is a nice-to-have (spam-toast defense), not
        // load-bearing for security.
      }
      // Full-page navigation — leaves the SPA. Chunk 3 review 2026-07-16:
      // wrap in try/catch — a synchronous throw (CSP form-action block,
      // popup blocker, sandboxed iframe) previously left the marker
      // stuck at '1' and left the user with no UI feedback. On throw:
      // clear the marker + surface the error toast.
      try {
        window.location.assign(result.authorizeUrl)
      } catch {
        clearInFlightMarker()
        toast.error(t('settings.integrations.googleMeet.connect.error'), {
          id: CONNECT_ERROR_TOAST_ID,
        })
      }
    },
    onError: () => {
      // Authorize failed (503 OAUTH_NOT_CONFIGURED, 429, 500, network,
      // Zod parse drift). Surface a toast so the user sees the click
      // acknowledged even though navigation never happened. Marker was
      // never set (still onSuccess-guarded), so no cleanup needed.
      toast.error(t('settings.integrations.googleMeet.connect.error'), {
        id: CONNECT_ERROR_TOAST_ID,
      })
    },
  })
}
