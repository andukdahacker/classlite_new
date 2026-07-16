/**
 * IntegrationsTab — Story 2-5c AC1 + AC2 + AC3.
 *
 * Renders 4 integration rows + Notifications placeholder inside the
 * shared Settings tabpanel. Google Meet is the only real integration in
 * v1 — Google Drive / Google Calendar / Zoom render as placeholder rows
 * with a disabled toggle + a small inline toast trigger explaining
 * "Coming in epic X" (mirrors DeadLinkTrigger's copy pattern per Sally
 * S8 fold — never render dishonest CTAs). Notifications section is a
 * placeholder empty-state — Epic 10 owns the full surface.
 *
 * Connect flow: <ConnectButton> fires useConnectGoogleMeet → server
 * signs state → browser navigates to Google → callback returns to
 * /settings?tab=integrations&status=connected → SettingsPage.callback-
 * return handler fires success toast + invalidates centerProfile.
 *
 * Disconnect flow: click ON toggle → <AlertDialog> confirms → DELETE →
 * cache flip → toast on success. AC3: does NOT hit Google's token-revoke
 * endpoint (FU-2-5-B files v2 remediation).
 */
import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { useCenterProfile } from './api/useCenterProfile'
import { useConnectGoogleMeet } from './api/useConnectGoogleMeet'
import { useDisconnectGoogleMeet } from './api/useDisconnectGoogleMeet'

interface Props {
  centerId: string
}

// Placeholder providers per AC1 — v1 ships Meet only per PRD.
type PlaceholderProvider = 'googleDrive' | 'googleCalendar' | 'zoom'
const PLACEHOLDER_PROVIDERS: readonly PlaceholderProvider[] = [
  'googleDrive',
  'googleCalendar',
  'zoom',
] as const

// Chunk 3 review 2026-07-16 (Minor #11): per-provider ID so clicking Drive
// then Calendar within Sonner's dedupe window shows the correct copy for
// each row, not the first click's copy re-echoed.
const placeholderToastId = (provider: PlaceholderProvider): string =>
  `settings-integration-placeholder-${provider}`

export function IntegrationsTab({ centerId }: Props): ReactElement {
  const { t } = useTranslation()
  const profileQuery = useCenterProfile(centerId)
  const connectMutation = useConnectGoogleMeet(centerId)
  const disconnectMutation = useDisconnectGoogleMeet(centerId)
  const [disconnectDialogOpen, setDisconnectDialogOpen] = useState(false)

  const connected = profileQuery.data?.googleMeetConnected ?? false

  return (
    <div
      role="tabpanel"
      id="settings-tabpanel-integrations"
      aria-labelledby="settings-tab-integrations"
      data-testid="settings-tabpanel-integrations"
      className="space-y-8"
    >
      <section
        aria-labelledby="settings-integrations-providers-heading"
        className="rounded-lg border border-slate-200 bg-white p-6"
      >
        <h2
          id="settings-integrations-providers-heading"
          className="text-lg font-semibold text-slate-900"
        >
          {t('settings.integrations.section.providers.heading')}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          {t('settings.integrations.section.providers.description')}
        </p>

        {profileQuery.isLoading && (
          <ul
            aria-busy="true"
            data-testid="settings-integrations-loading"
            className="mt-4 divide-y divide-slate-200"
          >
            {[0, 1, 2, 3].map((i) => (
              <li key={i} className="flex items-center justify-between py-3">
                <div className="h-4 w-40 animate-pulse rounded bg-slate-100" />
                <div className="h-6 w-16 animate-pulse rounded bg-slate-100" />
              </li>
            ))}
          </ul>
        )}

        {profileQuery.isError && (
          <div
            role="alert"
            data-testid="settings-integrations-error"
            className="mt-4 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-900"
          >
            {t('settings.error.fetch')}
            <div className="mt-3">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => profileQuery.refetch()}
              >
                {t('settings.error.tryAgain')}
              </Button>
            </div>
          </div>
        )}

        {profileQuery.isSuccess && (
          <ul className="mt-4 divide-y divide-slate-200">
            {/* Google Meet — real row */}
            <li
              className="flex items-center justify-between py-3"
              data-testid="settings-integration-row-google-meet"
            >
              <div>
                <p className="text-sm font-medium text-slate-900">
                  {t('settings.integrations.googleMeet.title')}
                </p>
                <p className="text-xs text-slate-500">
                  {t('settings.integrations.googleMeet.description')}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span
                  data-testid="settings-integrations-google-meet-state"
                  data-state={connected ? 'connected' : 'disconnected'}
                  aria-live="polite"
                  className={
                    connected
                      ? 'rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-900'
                      : 'rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700'
                  }
                >
                  {connected
                    ? t('settings.integrations.googleMeet.state.connected')
                    : t('settings.integrations.googleMeet.state.disconnected')}
                </span>
                {/*
                  Chunk 3 review 2026-07-16 (M1): a single role="switch" toggle
                  is the AC17-mandated pattern (screen readers announce
                  "switch, on"/"switch, off" instead of "button"). When
                  connected, clicking opens the disconnect confirmation dialog
                  (per AC3 "click ON toggle → AlertDialog"). When disconnected,
                  clicking fires the connect mutation directly.

                  The visible label AND action-labeled data-testid variants
                  are preserved (`settings-connect-google-meet-button` +
                  `settings-disconnect-google-meet-button`) so shipped tests
                  and route-bundle assertions keep working — data-testid is
                  applied conditionally to the same underlying <button>.
                */}
                <button
                  type="button"
                  role="switch"
                  aria-checked={connected}
                  aria-label={t('settings.integrations.googleMeet.toggle')}
                  data-testid={
                    connected
                      ? 'settings-disconnect-google-meet-button'
                      : 'settings-connect-google-meet-button'
                  }
                  onClick={() => {
                    if (connected) {
                      setDisconnectDialogOpen(true)
                    } else {
                      connectMutation.mutate()
                    }
                  }}
                  disabled={
                    connected
                      ? disconnectMutation.isPending
                      : connectMutation.isPending
                  }
                  className={
                    connected
                      ? 'inline-flex h-8 min-w-[104px] items-center justify-center rounded-md border border-slate-300 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50'
                      : 'inline-flex h-8 min-w-[104px] items-center justify-center rounded-md bg-blue-600 px-3 text-sm font-medium text-white hover:bg-blue-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:opacity-50'
                  }
                >
                  {connected
                    ? t('settings.integrations.googleMeet.disconnect.button')
                    : t('settings.integrations.googleMeet.connect.button')}
                </button>
              </div>
            </li>

            {/* Placeholder rows — Drive / Calendar / Zoom */}
            {PLACEHOLDER_PROVIDERS.map((provider) => (
              <li
                key={provider}
                className="flex items-center justify-between py-3"
                data-testid={`settings-integration-row-${provider}`}
              >
                <div>
                  <p className="text-sm font-medium text-slate-500">
                    {t(`settings.integrations.${provider}.title` as const)}
                  </p>
                  <p className="text-xs text-slate-400">
                    {t(`settings.integrations.${provider}.description` as const)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span
                    className="rounded-full bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-500"
                    data-testid={`settings-integrations-${provider}-not-ready`}
                  >
                    {t(`settings.integrations.${provider}.notReady` as const)}
                  </span>
                  <button
                    type="button"
                    className="text-xs font-medium text-slate-500 underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-500"
                    onClick={() =>
                      toast.info(
                        t(`settings.integrations.${provider}.notReady` as const),
                        { id: placeholderToastId(provider), duration: 4000 },
                      )
                    }
                  >
                    {t('settings.integrations.placeholder.moreInfo')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* Notifications placeholder — Epic 10 (Notifications) owns the body. */}
      <section
        aria-labelledby="settings-integrations-notifications-heading"
        className="rounded-lg border border-dashed border-slate-300 bg-slate-50 p-6 text-center"
        data-testid="settings-integrations-notifications-placeholder"
      >
        <h2
          id="settings-integrations-notifications-heading"
          className="text-base font-medium text-slate-600"
        >
          {t('settings.integrations.notifications.heading')}
        </h2>
        <p className="mt-2 text-sm text-slate-500">
          {t('settings.integrations.notifications.pending')}
        </p>
      </section>

      {/* Disconnect confirmation */}
      <AlertDialog
        open={disconnectDialogOpen}
        onOpenChange={setDisconnectDialogOpen}
      >
        <AlertDialogContent data-testid="settings-disconnect-google-meet-dialog">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('settings.integrations.googleMeet.disconnect.title')}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('settings.integrations.googleMeet.disconnect.description')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>
              {t('settings.integrations.googleMeet.disconnect.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="settings-disconnect-google-meet-confirm"
              // Chunk 3 review 2026-07-16 M8: disable during pending so a
              // double-click doesn't spawn two DELETE requests. Backend is
              // idempotent (per api.yaml) but duplicate audits + network
              // noise are still undesirable.
              disabled={disconnectMutation.isPending}
              onClick={() =>
                disconnectMutation.mutate(undefined, {
                  onSuccess: () => {
                    setDisconnectDialogOpen(false)
                    toast.success(
                      t('settings.integrations.googleMeet.disconnect.success'),
                      { id: 'settings-integration-disconnected' },
                    )
                  },
                  onError: () => {
                    // Chunk 3 review 2026-07-16 M7: close the dialog on
                    // error too — leaving it open with an error toast
                    // behind the backdrop is a stuck-state UX.
                    setDisconnectDialogOpen(false)
                    toast.error(
                      t('settings.integrations.googleMeet.disconnect.error'),
                      { id: 'settings-integration-disconnect-error' },
                    )
                  },
                })
              }
            >
              {t('settings.integrations.googleMeet.disconnect.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
