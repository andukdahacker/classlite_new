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
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useAuth } from '@/hooks/useAuth'
import { useRole } from '@/hooks/useRole'
import PermissionDenied from '@/components/shared/PermissionDenied'
// TODO(story-2-6): move to route-level errorElement + role gate per Winston-W-STRONG-9
import { useSettingsTab, type SettingsTab } from './hooks/useSettingsTab'
import { ProfileTab } from './ProfileTab'
import { TermCalendarTab } from './TermCalendarTab'
import { RoomsTab } from './RoomsTab'

const TAB_ORDER: readonly SettingsTab[] = [
  'profile',
  'terms',
  'integrations',
  'rooms',
] as const

// Only `integrations` still renders as a placeholder — 2-5c owns wiring it.
function IntegrationsPlaceholder(): ReactElement {
  const { t } = useTranslation()
  return (
    <div
      role="tabpanel"
      tabIndex={0}
      aria-labelledby="settings-tab-integrations"
      id="settings-tabpanel-integrations"
      data-testid="settings-tab-placeholder-integrations"
      className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-8 text-center text-sm text-slate-500"
    >
      {t('settings.tabPlaceholder.integrations')}
    </div>
  )
}

export default function SettingsPage(): ReactElement {
  const { t } = useTranslation()
  const { session } = useAuth()
  const role = useRole()
  const { tab, setTab } = useSettingsTab()
  const centerId = session?.center?.id ?? null

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
            return <IntegrationsPlaceholder />
        }
      })()}
    </div>
  )
}
