/**
 * useEnrolmentSchema — Story 7.3b (D6/D10). Locale-reactive Zod builder for the
 * s43 compose row (RHF + zodResolver), validating the compose form against an
 * `action`-discriminated rule set:
 *
 *   - add      → studentId + toClassId
 *   - transfer → studentId + fromClassId + toClassId (+ fromClassId ≠ toClassId,
 *                the client mirror of the server self-transfer 422)
 *   - withdraw → studentId + fromClassId
 *
 * Implementation note (pragmatic [[feedback_pragmatic_interpretation_of_spec_absolutes]]):
 * D6 describes a `z.discriminatedUnion('action', …)`. A discriminated-union
 * `z.infer` yields a UNION form type, which forces `Control<Union>` field access
 * to fail `tsc --strict` on fields absent from some variants (e.g. `toClassId`
 * on withdraw). We keep ONE flat object schema whose `.superRefine` enforces the
 * per-action requirements — the SAME action-discriminated validation contract,
 * with a single clean `z.infer` for RHF. Empty strings model "unset" so the
 * roster/class pickers can bind plain string fields.
 *
 * The effective-date guard is a lexical `≤ today` compare on the `YYYY-MM-DD`
 * wire string (D10 — no `new Date()` parsing in the schema, TS-6). Backdating is
 * allowed; only future dates are rejected. The server is authoritative (422).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const ENROLMENT_ACTIONS = ['add', 'transfer', 'withdraw'] as const
export type EnrolmentActionValue = (typeof ENROLMENT_ACTIONS)[number]

/**
 * Local calendar date as `YYYY-MM-DD`. Computed once at mount as a form default /
 * `max` attribute, NOT in a render-format path — so this is not the TS-6
 * `new Date()`-in-render footgun (the i18n formatter still owns display).
 */
export function todayIsoDate(now: Date = new Date()): string {
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export interface EnrolmentFormValues {
  action: EnrolmentActionValue
  studentId: string
  toClassId: string
  fromClassId: string
  effectiveDate: string
  note: string
}

export function useEnrolmentSchema(today: string) {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z
        .object({
          action: z.enum(ENROLMENT_ACTIONS),
          studentId: z.string().min(1, {
            message: t('people.enrolment.compose.error.studentRequired'),
          }),
          toClassId: z.string(),
          fromClassId: z.string(),
          effectiveDate: z.string().refine((value) => value === '' || value <= today, {
            message: t('people.enrolment.compose.error.futureDate'),
          }),
          note: z.string(),
        })
        .superRefine((values, ctx) => {
          const needsTarget = values.action === 'add' || values.action === 'transfer'
          const needsSource =
            values.action === 'transfer' || values.action === 'withdraw'
          if (needsTarget && values.toClassId === '') {
            ctx.addIssue({
              code: 'custom',
              path: ['toClassId'],
              message: t('people.enrolment.compose.error.targetRequired'),
            })
          }
          if (needsSource && values.fromClassId === '') {
            ctx.addIssue({
              code: 'custom',
              path: ['fromClassId'],
              message: t('people.enrolment.compose.error.sourceRequired'),
            })
          }
          if (
            values.action === 'transfer' &&
            values.fromClassId !== '' &&
            values.fromClassId === values.toClassId
          ) {
            ctx.addIssue({
              code: 'custom',
              path: ['toClassId'],
              message: t('people.enrolment.compose.error.selfTransfer'),
            })
          }
        }),
    [t, today],
  )
}
