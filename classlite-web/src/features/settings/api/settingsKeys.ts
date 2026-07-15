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
} as const
