/**
 * useSettingsTab — reads `?tab=` from URL and returns a typed tab id.
 *
 * Story 2-5a AC1 — tab state lives in the URL so deep-links + browser
 * back button do the right thing. Invalid `?tab=` values fall back to
 * `profile` per AC1 spec.
 */
import { useSearchParams } from 'react-router'

export type SettingsTab = 'profile' | 'terms' | 'integrations' | 'rooms'

const VALID_TABS: readonly SettingsTab[] = [
  'profile',
  'terms',
  'integrations',
  'rooms',
] as const

function isValidTab(value: string | null): value is SettingsTab {
  return value !== null && (VALID_TABS as readonly string[]).includes(value)
}

export interface UseSettingsTabResult {
  tab: SettingsTab
  setTab: (next: SettingsTab) => void
}

export function useSettingsTab(): UseSettingsTabResult {
  const [searchParams, setSearchParams] = useSearchParams()
  const raw = searchParams.get('tab')
  const tab: SettingsTab = isValidTab(raw) ? raw : 'profile'
  const setTab = (next: SettingsTab): void => {
    const nextParams = new URLSearchParams(searchParams)
    if (next === 'profile') {
      nextParams.delete('tab')
    } else {
      nextParams.set('tab', next)
    }
    // P13 (2026-07-15 review): use `replace: true` so tab switching does
    // not pollute browser history. Owner cycling Profile → Terms →
    // Integrations → Rooms → Profile previously stacked 5 back-history
    // entries; Back button now leaves `/settings` on the first press.
    setSearchParams(nextParams, { replace: true })
  }
  return { tab, setTab }
}
