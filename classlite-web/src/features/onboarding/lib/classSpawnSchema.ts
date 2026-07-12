/**
 * useClassSpawnSchema — Story 2-3b AC4/AC6/AC7/AC8/AC9, Task 2.1.
 *
 * Locale-reactive Zod builder-hook for the class-spawn form. Mirrors
 * `useCenterSetupSchema.ts:45-73` verbatim per Amelia-S6 fold.
 *
 * - Rune-count: `Array.from(v).length` mirrors 2-3a Amelia-B1 fix so multi-byte
 *   Vietnamese diacritics + emoji surrogate pairs measure the same 120-rune
 *   ceiling client + server.
 * - Padded ISO date (Winston-I4): reject Safari's `YYYY-M-D` output.
 * - Empty→null teacher email (Winston-I5 + Story 2.1 nullableText lesson).
 * - Array bounds [1, 20] per Story 2.2 AC3.
 * - No `studentEmails` field (Sally-S4 fold — textarea deferred entirely).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const COHORT_NAME_MAX_RUNES = 120
export const CLASSES_MAX = 20
// R1-C2-P10 — cap the future horizon so `Date` math cannot overflow / produce
// visually absurd dates. 5 years is comfortably beyond IELTS course horizons
// (typical prep is 3–12 months).
export const START_DATE_MAX_YEARS_AHEAD = 5

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Lenient 8-4-4-4-12 hex UUID pattern — the Story 2.2 system-seed IDs (fixed
// UUIDs `11111111-2222-3333-4444-55555555550{1..5}`) do not honor RFC 4122
// variant bits, so `z.uuid()` (which enforces `[89abAB]` at position 13)
// would reject them.
const UUID_LENIENT_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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

function startOfUtcDay(ts: number): number {
  const d = new Date(ts)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
}

function notMoreThan30DaysInPast(v: string): boolean {
  const [y, m, d] = v.split('-').map(Number)
  const inputUtcDay = Date.UTC(y, m - 1, d)
  const todayUtcDay = startOfUtcDay(Date.now())
  const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000
  return inputUtcDay >= todayUtcDay - thirtyDaysMs
}

// R1-C2-P10 — reject `9999-12-31`-style far-future dates.
function notMoreThanNYearsAhead(v: string): boolean {
  const [y] = v.split('-').map(Number)
  const nowYear = new Date(Date.now()).getUTCFullYear()
  return y <= nowYear + START_DATE_MAX_YEARS_AHEAD
}

export function useClassSpawnSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        templateId: z.string().regex(UUID_LENIENT_RE).nullable(),
        classes: z
          .array(
            z.object({
              cohortName: z
                .string()
                .transform((v) => v.trim())
                .refine((v) => runeLength(v) >= 1, {
                  message: t('onboarding.spawn.error.cohortRequired'),
                })
                .refine((v) => runeLength(v) <= COHORT_NAME_MAX_RUNES, {
                  message: t('onboarding.spawn.error.cohortMax', {
                    max: COHORT_NAME_MAX_RUNES,
                  }),
                }),
              startDate: z
                .string()
                .refine(isValidIsoDate, {
                  message: t('onboarding.spawn.error.startDateInvalid'),
                })
                .refine(notMoreThan30DaysInPast, {
                  message: t('onboarding.spawn.error.startDatePast'),
                })
                .refine(notMoreThanNYearsAhead, {
                  message: t('onboarding.spawn.error.startDateTooFarFuture', {
                    years: START_DATE_MAX_YEARS_AHEAD,
                  }),
                }),
              // R1-C2-P9 — the schema keeps the tight `[string, null]` union so
              // RHF's `TFieldValues` input and output stay aligned (adding
              // `undefined` diverges the input type from `z.infer<>` output
              // and breaks the `zodResolver` type contract). Callers MUST
              // always supply `teacherEmail: null` explicitly in defaults /
              // reset — `EMPTY_ROW` in `ClassSpawnPage` and the `savedRows`
              // hydrate path both honor this. Documented so a future dev
              // introducing a form.reset() that omits the key gets caught
              // by TS rather than at runtime.
              teacherEmail: z
                .union([z.string(), z.null()])
                .transform((v) => {
                  if (v === null) return null
                  const trimmed = v.trim()
                  return trimmed === '' ? null : trimmed
                })
                .pipe(
                  z
                    .email({
                      message: t('onboarding.spawn.error.teacherEmailInvalid'),
                    })
                    .nullable(),
                ),
            }),
          )
          .min(1)
          .max(CLASSES_MAX),
      }),
    [t],
  )
}

export type ClassSpawnFormValues = z.infer<
  ReturnType<typeof useClassSpawnSchema>
>
