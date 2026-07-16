/**
 * settingsKeys — TS-3 query-key factory for the Settings feature.
 *
 * Story 2-5a lands the profile slot. Story 2-5b will extend with
 * `terms(centerId) / holidays(centerId) / rooms(centerId)`; Story 2-5c
 * will extend with `integration(provider)`. Mirror the shipped
 * `authKeys.ts` shape so `invalidateQueries` at a prefix cascades.
 */
export const settingsKeys = {
  all: ['settings'] as const,
  centerProfile: (centerId: string) =>
    [...settingsKeys.all, 'centerProfile', centerId] as const,
  // P11 (2026-07-15 review): sentinel key for the disabled state (no
  // centerId yet). Kept inside the factory so all settings-scoped keys
  // share a common prefix; `invalidateQueries({ queryKey: settingsKeys.all })`
  // covers this slot too.
  centerProfileDisabled: () =>
    [...settingsKeys.all, 'centerProfile', '__disabled__'] as const,
  updateCenterProfileMutation: (centerId: string) =>
    [
      ...settingsKeys.all,
      'mutation',
      'updateCenterProfile',
      centerId,
    ] as const,
  // Story 2-5b extension — terms + holidays + rooms.
  terms: (centerId: string) =>
    [...settingsKeys.all, 'terms', centerId] as const,
  holidays: (centerId: string) =>
    [...settingsKeys.all, 'holidays', centerId] as const,
  rooms: (centerId: string) =>
    [...settingsKeys.all, 'rooms', centerId] as const,
  // Story 2-5c extension — per-center integration slot. Provider is a
  // parameter so future providers (google_drive, zoom) plug in without a
  // key-shape change; today only 'google_meet' is populated.
  integration: (centerId: string, provider: string) =>
    [...settingsKeys.all, 'integration', centerId, provider] as const,
} as const
