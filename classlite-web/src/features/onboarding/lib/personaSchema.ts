/**
 * Persona enum + membership check for Story 2-3a AC1/AC3.
 *
 * The persona values match Story 2.1's `POST /api/onboarding/persona`
 * contract — do NOT rename without an api.yaml amendment. `isPersonaValue`
 * validates untrusted server responses before we render `aria-checked`
 * against the enum (R1-P14).
 *
 * Note: PersonaSelectPage uses a plain `useState<PersonaValue | null>`
 * rather than RHF + Zod — the persona pick is a single one-shot POST, not
 * a form with multi-field validation. The previous Zod builder-hook was
 * dead code (R1-P34) and was removed here.
 */
export const PERSONA_VALUES = ['operator', 'founder', 'solo_teacher'] as const
export type PersonaValue = (typeof PERSONA_VALUES)[number]

export function isPersonaValue(value: unknown): value is PersonaValue {
  return (
    typeof value === 'string' &&
    (PERSONA_VALUES as readonly string[]).includes(value)
  )
}
