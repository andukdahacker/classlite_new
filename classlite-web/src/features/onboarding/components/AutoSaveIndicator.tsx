/**
 * AutoSaveIndicator — Story 2-3a AC4 + Task 5.3.
 *
 * Renders the shell's top-right "Auto-saving · last saved Ns ago" affordance.
 * States (Sally-B2 fold):
 *   - `idle` (fresh mount, no save yet) → `onboarding.wizard.autoSaving.idle`
 *     ("Auto-save on"). NOT "Not yet saved" — that reads as error on first
 *     paint.
 *   - `saving` → `onboarding.wizard.autoSaving.saving`.
 *   - `saved` → `onboarding.wizard.autoSaving.saved` with `{{seconds}}` since
 *     the last successful PUT (visual-only tick — NEVER announced).
 *   - `error` → `onboarding.wizard.autoSaving.failed`.
 *   - `persistentFailure` → inline banner
 *     `onboarding.wizard.autoSaving.failedPersistent` after ≥3 consecutive
 *     failures. Clears when a save succeeds.
 *
 * `aria-live="polite"` on the STATE region announces transitions only
 * (idle→saving, saving→saved, saved→failed, failed→persistent-banner). The
 * ticking `{{seconds}}` value NEVER updates the aria-live region — otherwise
 * screen readers get a noise assault every debounce cycle (Sally-I2 fold).
 */
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useOnboardingAutoSave } from '../OnboardingAutoSaveContext'

const TICK_INTERVAL_MS = 1_000

export function AutoSaveIndicator() {
  const { t } = useTranslation()
  const { savingState, lastSavedAt, retryNow } = useOnboardingAutoSave()
  const [now, setNow] = useState<number>(() => Date.now())

  useEffect(() => {
    if (savingState !== 'saved' || lastSavedAt === null) return
    const id = setInterval(() => {
      setNow(Date.now())
    }, TICK_INTERVAL_MS)
    return () => clearInterval(id)
  }, [savingState, lastSavedAt])

  const visibleLabel = visibleMessage(t, savingState, lastSavedAt, now)
  const announcement = stateAnnouncement(t, savingState)

  if (savingState === 'persistentFailure') {
    return (
      <div
        role="status"
        aria-live="polite"
        className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-1 text-sm text-amber-900"
        data-testid="auto-save-persistent-banner"
      >
        <span>{t('onboarding.wizard.autoSaving.failedPersistent')}</span>
        <button
          type="button"
          onClick={() => void retryNow()}
          className="rounded border border-amber-400 bg-amber-100 px-2 py-0.5 text-xs font-medium hover:bg-amber-200"
          data-testid="auto-save-retry-now"
        >
          {t('onboarding.wizard.autoSaving.retryNow')}
        </button>
      </div>
    )
  }

  // Sally-I2 fold: the aria-live region announces STATE TRANSITIONS only —
  // `announcement` never contains the ticking seconds counter, so screen
  // readers do not get a noise assault every second. The visible label
  // (which does include the tick) is aria-hidden so sighted users still
  // see "Last saved 5s ago" without breaking the SR contract.
  return (
    <div
      className="text-sm text-muted-foreground"
      data-testid="auto-save-indicator"
    >
      <span role="status" aria-live="polite" className="sr-only">
        {announcement}
      </span>
      <span aria-hidden="true">{visibleLabel}</span>
    </div>
  )
}

function stateAnnouncement(
  t: (key: string, params?: Record<string, unknown>) => string,
  state: ReturnType<typeof useOnboardingAutoSave>['savingState'],
): string {
  switch (state) {
    case 'saving':
      return t('onboarding.wizard.autoSaving.saving')
    case 'error':
      return t('onboarding.wizard.autoSaving.failed')
    case 'saved':
      // Static form — the ticking seconds are visual-only.
      return t('onboarding.wizard.autoSaving.savedAnnouncement')
    case 'idle':
    default:
      return t('onboarding.wizard.autoSaving.idle')
  }
}

function visibleMessage(
  t: (key: string, params?: Record<string, unknown>) => string,
  state: ReturnType<typeof useOnboardingAutoSave>['savingState'],
  lastSavedAt: string | null,
  nowMs: number,
): string {
  switch (state) {
    case 'saving':
      return t('onboarding.wizard.autoSaving.saving')
    case 'error':
      return t('onboarding.wizard.autoSaving.failed')
    case 'saved': {
      if (lastSavedAt === null) {
        return t('onboarding.wizard.autoSaving.saved', { seconds: 0 })
      }
      const parsed = Date.parse(lastSavedAt)
      if (!Number.isFinite(parsed)) {
        return t('onboarding.wizard.autoSaving.idle')
      }
      const deltaSeconds = Math.max(
        0,
        Math.floor((nowMs - parsed) / 1000),
      )
      return t('onboarding.wizard.autoSaving.saved', { seconds: deltaSeconds })
    }
    case 'idle':
    default:
      return t('onboarding.wizard.autoSaving.idle')
  }
}
