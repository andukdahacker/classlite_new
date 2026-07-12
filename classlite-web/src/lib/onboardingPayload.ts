/**
 * Onboarding progress payload — typed FE contract for the opaque
 * `templateDraft` field in `OnboardingProgressPayload`.
 *
 * Location: `src/lib/onboardingPayload.ts` (shared library) — Winston-S1
 * party-mode fold. NOT `src/features/onboarding/lib/*` — Story 2.3c
 * re-imports this same file for the completion screen; a feature-local
 * type would silently drift when 2.3c reads via cross-feature deep import
 * (TS-7 boundary).
 *
 * Story 2-3b Task 2.2 contract lock — do NOT extend the shape without
 * an amendment; 2.3c will grep for these field names.
 *
 * `OnboardingProgressPayload.templateDraft` in api.yaml is
 * `additionalProperties: true` (opaque JSON) — this file's shape is
 * the frontend's own contract. When Story 2.4 stabilizes the shape,
 * FU-2-3b-H tracks pinning it in api.yaml via `oneOf`.
 */

/**
 * Payload shape written into `OnboardingProgressPayload.templateDraft`
 * by the template-selection + spawn + Solo-first-class pages.
 *
 * Fields:
 *  - `selectedTemplateId` — server UUID of the picked template; null when
 *    user chose "Build from scratch" (buildFromScratch: true).
 *  - `buildFromScratch` — user explicitly picked the "Build from scratch"
 *    tile; the spawn page renders the AC4 Build-from-scratch-blocked
 *    variant (CTA is "← Pick a template", not "Save & spawn"). Story 2-3b
 *    R1-C1-P14 (TS-1): explicit `null` clears a prior `true`; `undefined`
 *    is never written by the FE (`JSON.stringify` would drop the key and
 *    silently strip a "clear" write).
 *  - `spawnedClassIds` — populated post-201 by AC6 (c.ii) terminal PUT;
 *    Story 2.3c reads this array to render the completion summary. Do
 *    NOT nest deeper than this path — 2.3c will grep for it verbatim.
 *  - `classesDraft` — captures the spawn-form work-in-progress state so
 *    the user can walk away mid-form and resume. teacherEmail is nullable
 *    (empty display + Founder wire-null decoupling per Winston-W4).
 */
export interface TemplateDraftPayload {
  selectedTemplateId: string | null
  buildFromScratch?: boolean | null
  spawnedClassIds?: string[]
  classesDraft?: Array<{
    cohortName: string
    /** ISO-8601 date `YYYY-MM-DD` (10 chars, padded); empty string allowed while user types. */
    startDate: string
    teacherEmail: string | null
  }>
}

/**
 * Draft row shape used by ClassSpawnPage's RHF `useFieldArray`. Same as
 * `classesDraft[N]` above but expressed as a standalone type so form
 * schemas + row components can reference it without pulling the whole
 * `TemplateDraftPayload` interface.
 */
export type ClassRowDraft = NonNullable<
  TemplateDraftPayload['classesDraft']
>[number]
