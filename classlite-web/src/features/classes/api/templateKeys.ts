/**
 * templateKeys — TS-3 query-key factory for the Templates management surface
 * (Story 3.3, screens s19/s20/s21).
 *
 * Deliberately SEPARATE from the wizard-coupled `onboardingKeys.templates()`:
 * the onboarding picker cache is a flat, non-tenant-scoped list used by the
 * class-creation wizard; the management surface needs list + per-id detail +
 * mutation keys and a tenant-scoped list slot (same posture as `classesKeys`).
 */
export const templateKeys = {
  all: ['templates'] as const,
  lists: () => [...templateKeys.all, 'list'] as const,
  list: (centerId: string) => [...templateKeys.all, 'list', centerId] as const,
  listDisabled: () => [...templateKeys.all, 'list', '__disabled__'] as const,
  detail: (id: string) => [...templateKeys.all, 'detail', id] as const,
  createMutation: () => [...templateKeys.all, 'mutation', 'create'] as const,
  updateMutation: (id: string) =>
    [...templateKeys.all, 'mutation', 'update', id] as const,
  deleteMutation: (id: string) =>
    [...templateKeys.all, 'mutation', 'delete', id] as const,
} as const
