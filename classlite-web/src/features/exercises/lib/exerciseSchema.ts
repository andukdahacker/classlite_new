/**
 * useExerciseSchema — Story 4.1 (AC3). Locale-reactive Zod builder for the
 * exercise create/edit form (RHF + zodResolver). Hand-written per the
 * classSchema precedent (openapi-zod-client disabled). Messages resolve to i18n
 * keys. Tags are a single comma-separated input string here (split into an
 * array at submit time).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const EXERCISE_TITLE_MAX_RUNES = 200
export const TARGET_BAND_MIN = 0
export const TARGET_BAND_MAX = 9

export const EXERCISE_SKILLS = [
  'reading',
  'listening',
  'writing',
  'speaking',
  'grammar',
  'vocabulary',
  'general',
] as const

function runeLength(v: string): number {
  return Array.from(v).length
}

export function useExerciseSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        title: z
          .string()
          .transform((v) => v.trim())
          .refine((v) => runeLength(v) >= 1, {
            message: t('exercises.form.errors.titleRequired'),
          })
          .refine((v) => runeLength(v) <= EXERCISE_TITLE_MAX_RUNES, {
            message: t('exercises.form.errors.titleMax', {
              max: EXERCISE_TITLE_MAX_RUNES,
            }),
          }),
        skill: z.enum(EXERCISE_SKILLS),
        tags: z.string().optional(),
        description: z.string().optional(),
        targetBand: z
          .number()
          .min(TARGET_BAND_MIN, {
            message: t('exercises.form.errors.bandRange', {
              min: TARGET_BAND_MIN,
              max: TARGET_BAND_MAX,
            }),
          })
          .max(TARGET_BAND_MAX, {
            message: t('exercises.form.errors.bandRange', {
              min: TARGET_BAND_MIN,
              max: TARGET_BAND_MAX,
            }),
          })
          .optional(),
      }),
    [t],
  )
}

export type ExerciseFormValues = z.infer<ReturnType<typeof useExerciseSchema>>

/** Split a comma-separated tags input into a trimmed, de-duped, non-empty array. */
export function parseTagsInput(raw: string | undefined): string[] {
  if (!raw) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of raw.split(',')) {
    const tag = part.trim()
    if (tag && !seen.has(tag)) {
      seen.add(tag)
      out.push(tag)
    }
  }
  return out
}
