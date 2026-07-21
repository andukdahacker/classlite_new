/**
 * useTemplateSchema — Story 3.3 (AC6). Locale-reactive Zod builder for the
 * template create/edit form (RHF + zodResolver), mirroring `useClassSchema`.
 * `sessionCount` is NOT a field — it is DERIVED = sessions.length; the schema
 * enforces sessions.length >= 1. Per-session `duration` is optional (5–600 min).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const TEMPLATE_NAME_MAX_RUNES = 120
export const SESSION_TITLE_MAX_RUNES = 200
export const TARGET_BAND_MIN = 1
export const TARGET_BAND_MAX = 9
export const TARGET_BAND_STEP = 0.5
export const SESSION_DURATION_MIN = 5
export const SESSION_DURATION_MAX = 600
export const SESSIONS_MAX = 100

export const PRIMARY_SKILLS = [
  'writing',
  'speaking',
  'listening',
  'reading',
  'listening_reading',
  'all_skills',
] as const

function runeLength(v: string): number {
  return Array.from(v).length
}

export function useTemplateSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const sessionSchema = z.object({
      title: z
        .string()
        .transform((v) => v.trim())
        .refine((v) => runeLength(v) >= 1, {
          message: t('classes.templates.form.errors.sessionTitleRequired'),
        })
        .refine((v) => runeLength(v) <= SESSION_TITLE_MAX_RUNES, {
          message: t('classes.templates.form.errors.sessionTitleMax', {
            max: SESSION_TITLE_MAX_RUNES,
          }),
        }),
      description: z.string().optional(),
      duration: z
        .number()
        .int()
        .min(SESSION_DURATION_MIN, {
          message: t('classes.templates.form.errors.durationRange', {
            min: SESSION_DURATION_MIN,
            max: SESSION_DURATION_MAX,
          }),
        })
        .max(SESSION_DURATION_MAX, {
          message: t('classes.templates.form.errors.durationRange', {
            min: SESSION_DURATION_MIN,
            max: SESSION_DURATION_MAX,
          }),
        })
        .nullable()
        .optional(),
    })

    return z.object({
      name: z
        .string()
        .transform((v) => v.trim())
        .refine((v) => runeLength(v) >= 1, {
          message: t('classes.templates.form.errors.nameRequired'),
        })
        .refine((v) => runeLength(v) <= TEMPLATE_NAME_MAX_RUNES, {
          message: t('classes.templates.form.errors.nameMax', {
            max: TEMPLATE_NAME_MAX_RUNES,
          }),
        }),
      targetBand: z
        .number({ message: t('classes.templates.form.errors.targetBandRequired') })
        .min(TARGET_BAND_MIN, {
          message: t('classes.templates.form.errors.targetBandRange'),
        })
        .max(TARGET_BAND_MAX, {
          message: t('classes.templates.form.errors.targetBandRange'),
        })
        // CR-3-3 fix — mirror the server's 0.5-step rule client-side so a typed
        // value like 6.3 surfaces as a field error instead of a generic 422 banner.
        .multipleOf(TARGET_BAND_STEP, {
          message: t('classes.templates.form.errors.targetBandStep'),
        }),
      primarySkill: z.enum(PRIMARY_SKILLS),
      color: z.string().optional(),
      sessions: z
        .array(sessionSchema)
        .min(1, { message: t('classes.templates.form.errors.sessionsMin') })
        .max(SESSIONS_MAX, {
          message: t('classes.templates.form.errors.sessionsMax', {
            max: SESSIONS_MAX,
          }),
        }),
    })
  }, [t])
}

export type TemplateFormValues = z.infer<ReturnType<typeof useTemplateSchema>>
export type TemplateSessionFormValue = TemplateFormValues['sessions'][number]
