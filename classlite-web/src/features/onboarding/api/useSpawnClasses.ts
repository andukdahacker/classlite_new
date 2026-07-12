/**
 * useSpawnClasses — Story 2-3b Task 3.2 / AC6.
 *
 * `POST /api/templates/{templateId}/spawn` — spawn 1..20 classes from a
 * starter template. Returns the envelope-unwrapped `SpawnResult`.
 *
 * Winston-W3 fold: `onSuccess` does NOT invalidate `onboardingKeys.templates()`
 * — by the time the mutation resolves the user has left `/setup/template`;
 * the templates query is inactive, invalidate is spec noise. If Story 2.5
 * later ships center-owned template CRUD, THAT story's mutation invalidates.
 *
 * Winston-W4 fold: the wire `teacherEmail` field is decoupled from UI
 * display state. Founder row 0 UI shows the pill + star but the wire
 * ships `teacherEmail: null` so the server reliably returns
 * `teacherAssignmentReason: 'founder_auto'`. That decision lives at the
 * ClassSpawnPage submit-handler layer — this hook just posts what's given.
 */
import { useMutation } from '@tanstack/react-query'
import type { components } from '@/lib/api/client'
import { apiFetch } from '@/lib/api-fetch'
import { onboardingKeys } from './onboardingKeys'

export type SpawnClassInput = components['schemas']['SpawnClassInput']
export type SpawnResult = components['schemas']['SpawnResult']
export type SpawnedClass = components['schemas']['SpawnedClass']

export interface SpawnClassesVariables {
  templateId: string
  classes: SpawnClassInput[]
}

export function useSpawnClasses() {
  return useMutation({
    mutationKey: onboardingKeys.spawnMutation(),
    // R1-C2-P20 — invariant marker: `onSuccess` is intentionally OMITTED.
    // Do NOT add `onSuccess: (data, vars, ctx) => qc.invalidateQueries(...)`.
    // Reason (Winston-W3): the user has left `/setup/template` by the time
    // this resolves; the templates query is inactive, invalidation would be
    // wasted work. If Story 2.5 later ships center-owned template CRUD,
    // THAT story's mutation invalidates — not this one.
    mutationFn: ({ templateId, classes }: SpawnClassesVariables) =>
      apiFetch<SpawnResult>(`/api/templates/${templateId}/spawn`, {
        method: 'POST',
        body: JSON.stringify({ classes }),
      }),
  })
}
