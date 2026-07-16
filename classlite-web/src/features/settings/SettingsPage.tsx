/**
 * SettingsPage — Story 2-5a AC1 + AC2.
 *
 * `/settings` mounts inside AppLayout with a 4-tab strip. Owner-only —
 * non-Owner (Teacher/Admin/Student) hits `<PermissionDenied>` rendered
 * inline (NOT full-bleed — sidebar + topbar stay visible so the user can
 * navigate away). Route-level errorElement gate lands in Story 2.6 per
 * FU-2-5-H.
 *
 * Tab state lives in the URL: `/settings` (Profile), `/settings?tab=terms`,
 * etc. Invalid `?tab=` falls back to Profile per AC1.
 *
 * Only the Profile tab body ships in 2-5a — Terms/Rooms/Integrations
 * render placeholder EmptyStates that reference their sub-story. Copy
 * removed when 2-5b/2-5c land.
 */
import { useLayoutEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, useLocation } from 'react-router'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import PermissionDenied from '@/components/shared/PermissionDenied'
// TODO(story-2-6): move to route-level errorElement + role gate per Winston-W-STRONG-9
import { useSettingsTab, type SettingsTab } from './hooks/useSettingsTab'
import { ProfileTab } from './ProfileTab'
import { TermCalendarTab } from './TermCalendarTab'
import { RoomsTab } from './RoomsTab'
import { IntegrationsTab } from './IntegrationsTab'
import { settingsKeys } from './api/settingsKeys'
import { CONNECT_IN_FLIGHT_MARKER_KEY } from './api/connectMarker'
import type { CenterProfile } from './api/useCenterProfile'

// Story 2-5c AC14 — callback-return toast id (queue-of-one via Sonner id).
const CONNECT_SUCCESS_TOAST_ID = 'settings-integration-connected'
// Chunk 3 review 2026-07-16 (B1): symmetric id for cancel-flow neutral toast.
const CONNECT_CANCELLED_TOAST_ID = 'settings-integration-cancelled'

const TAB_ORDER: readonly SettingsTab[] = [
  'profile',
  'terms',
  'integrations',
  'rooms',
] as const

export default function SettingsPage(): ReactElement {
  const { t } = useTranslation()
  const { session } = useAuth()
  const role = useRole()
  const { tab, setTab } = useSettingsTab()
  const centerId = session?.center?.id ?? null
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // Story 2-5c AC14 — callback-return handling. On mount (and whenever the
  // ?status= query flips), branch on `status`:
  //   - `connected` + marker present → success toast + strip + invalidate
  //   - `connected` + no marker (drive-by URL manipulation) → NO toast, strip
  //   - `cancelled` (Chunk 3 review B1 fix) → neutral toast + strip + clear marker
  //   - anything else → no-op
  //
  // De-dupe: Sonner's `id: <fixed>` collapses a double-invoke into one visible
  // toast (StrictMode dev + concurrent-mode friendly). `useLayoutEffect` runs
  // synchronously with the DOM commit so the URL strip happens before any
  // subsequent-render subscriber can observe the stale param.
  useLayoutEffect(() => {
    if (!centerId) return
    const params = new URLSearchParams(location.search)
    const status = params.get('status')
    if (status !== 'connected' && status !== 'cancelled') return

    let marker: string | null = null
    try {
      marker = window.sessionStorage.getItem(CONNECT_IN_FLIGHT_MARKER_KEY)
    } catch {
      // sessionStorage can throw in private-mode; treat as "no marker".
    }
    const strippedParams = new URLSearchParams(location.search)
    strippedParams.delete('status')
    const search = strippedParams.toString()
    navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '' },
      { replace: true },
    )

    // Clear the marker whenever we strip a callback-return status param —
    // both connected and cancelled complete the in-flight cycle. Skipping
    // this on the cancelled branch would leak a stale marker into the next
    // return and could fire a spurious success toast (Chunk 3 review B1).
    if (marker === '1') {
      try {
        window.sessionStorage.removeItem(CONNECT_IN_FLIGHT_MARKER_KEY)
      } catch {
        // ignore
      }
    }

    if (status === 'connected') {
      // Drive-by URL defense: only fire the toast when the marker proves this
      // browser session initiated the connect flow.
      if (marker !== '1') return
      // Optimistic set (Chunk 3 review Minor #12): flip the pill to
      // "Connected" immediately so the success toast and pill agree during
      // the 200-500ms invalidation refetch window.
      queryClient.setQueryData<CenterProfile>(
        settingsKeys.centerProfile(centerId),
        (prev) => (prev ? { ...prev, googleMeetConnected: true } : prev),
      )
      toast.success(t('settings.integrations.googleMeet.connect.success'), {
        id: CONNECT_SUCCESS_TOAST_ID,
      })
      queryClient.invalidateQueries({
        queryKey: settingsKeys.centerProfile(centerId),
      })
    } else {
      // status === 'cancelled' — Chunk 1 D2 fix landed a 302 to
      // ?status=cancelled when Google returns ?error=access_denied. Fire a
      // NEUTRAL toast (not error banner) — the state is fine, the user
      // simply declined. Marker was cleared above. No invalidate needed
      // (no server-side state changed).
      toast.info(t('settings.integrations.googleMeet.connect.cancelled'), {
        id: CONNECT_CANCELLED_TOAST_ID,
      })
    }
    // ESLint: t + navigate + queryClient are stable identities; centerId +
    // location.search are the meaningful deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerId, location.search])

  if (role !== 'owner') {
    return (
      <div data-testid="settings-permission-denied">
        <PermissionDenied requiredRoles={['owner']} />
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6">
      <h1 className="text-2xl font-semibold text-slate-900">
        {t('sidebar.section.settings')}
      </h1>
      <div
        role="tablist"
        aria-label={t('sidebar.section.settings')}
        data-testid="settings-tab-strip"
        className="flex flex-wrap gap-1 border-b border-slate-200"
      >
        {TAB_ORDER.map((id) => {
          const active = tab === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`settings-tab-${id}`}
              aria-selected={active}
              aria-controls={`settings-tabpanel-${id}`}
              tabIndex={active ? 0 : -1}
              data-testid={`settings-tab-${id}`}
              onClick={() => setTab(id)}
              className={
                active
                  ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-700'
                  : 'border-b-2 border-transparent px-4 py-2 text-sm font-medium text-slate-600 hover:text-slate-900'
              }
            >
              {t(`settings.tabs.${id}` as const)}
            </button>
          )
        })}
      </div>
      {(() => {
        if (!centerId) {
          // Defensive — Owner reaching /settings without session.center is
          // a pre-onboarding state that shouldn't exist post-Story 2-4.
          return (
            <div
              role="alert"
              className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
              data-testid="settings-no-center"
            >
              {t('settings.error.fetch')}
            </div>
          )
        }
        switch (tab) {
          case 'profile':
            return <ProfileTab centerId={centerId} />
          case 'terms':
            return <TermCalendarTab centerId={centerId} />
          case 'rooms':
            return <RoomsTab centerId={centerId} />
          case 'integrations':
            return <IntegrationsTab centerId={centerId} />
        }
      })()}
    </div>
  )
}
