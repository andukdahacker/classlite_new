/**
 * useClassSchema — Story 3.1 (AC8). Locale-reactive Zod builder for the single
 * class create/edit form (RHF + zodResolver).
 *
 * Field validators are COPIED from `onboarding/lib/classSpawnSchema.ts` (rune
 * count, padded-ISO date, range) rather than re-pointing that shipped flow's
 * import — the onboarding spawn form stays untouched. The duplication is
 * tracked debt (FU-3-1: extract shared class-field validators). No array
 * wrapper (single class); Zod messages resolve to i18n keys.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const CLASS_NAME_MAX_RUNES = 120
export const START_DATE_MAX_YEARS_AHEAD = 5
export const TARGET_BAND_MIN = 0
export const TARGET_BAND_MAX = 9

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const UUID_LENIENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Pragmatic email shape (matches the server's net/mail acceptance closely
// enough for form UX; the server is the authority).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

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

function isValidIsoDate(v: string): boolean {
  if (!ISO_DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

function notMoreThanNYearsAhead(v: string): boolean {
  const [y] = v.split('-').map(Number)
  const nowYear = new Date(Date.now()).getUTCFullYear()
  return y <= nowYear + START_DATE_MAX_YEARS_AHEAD
}

export function useClassSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    const optionalIsoDate = z
      .string()
      .refine((v) => v === '' || isValidIsoDate(v), {
        message: t('classes.form.errors.dateInvalid'),
      })
      .refine((v) => v === '' || notMoreThanNYearsAhead(v), {
        message: t('classes.form.errors.dateTooFar'),
      })
      .optional()

    return z.object({
      templateId: z.string().regex(UUID_LENIENT_RE).nullable().optional(),
      name: z
        .string()
        .transform((v) => v.trim())
        .refine((v) => runeLength(v) >= 1, {
          message: t('classes.form.errors.nameRequired'),
        })
        .refine((v) => runeLength(v) <= CLASS_NAME_MAX_RUNES, {
          message: t('classes.form.errors.nameMax', { max: CLASS_NAME_MAX_RUNES }),
        }),
      description: z.string().optional(),
      targetBand: z
        .number()
        .min(TARGET_BAND_MIN)
        .max(TARGET_BAND_MAX)
        .optional(),
      primarySkill: z.enum(PRIMARY_SKILLS).optional(),
      sessionCount: z.number().int().min(1).optional(),
      capacity: z
        .number()
        .int()
        .min(1, { message: t('classes.form.errors.capacityPositive') })
        .optional(),
      startDate: optionalIsoDate,
      endDate: optionalIsoDate,
      color: z.string().optional(),
      dueDatesEnabled: z.boolean().optional(),
      teacherId: z.string().regex(UUID_LENIENT_RE).nullable().optional(),
      pendingTeacherEmail: z
        .string()
        // Empty string = "no teacher email" (the field left blank), treated as
        // unset — only a non-empty value is shape-checked. buildCreatePayload
        // omits empty values so the column stays NULL/unassigned.
        .refine((v) => v === '' || EMAIL_RE.test(v), {
          message: t('classes.form.errors.teacherEmailInvalid'),
        })
        .nullable()
        .optional(),
    })
  }, [t])
}

export type ClassFormValues = z.infer<ReturnType<typeof useClassSchema>>
