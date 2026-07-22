/**
 * useSessionSchema — Story 3.4 (AC8). Locale-reactive Zod builder for the
 * session create/edit form (RHF + zodResolver). Form shape is distinct from the
 * generated wire type (TS-2). Recurring patterns require an end date + at least
 * one weekday (weekly/custom); messages resolve to i18n keys.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export const SESSION_TOPIC_MAX = 200
export const RECURRENCE_PATTERNS = ['none', 'daily', 'weekly', 'custom'] as const
export type RecurrencePatternForm = (typeof RECURRENCE_PATTERNS)[number]

const UUID_LENIENT_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function useSessionSchema() {
  const { t } = useTranslation()
  return useMemo(() => {
    return z
      .object({
        classId: z.string().regex(UUID_LENIENT_RE, { message: t('schedule.modal.validation.classRequired') }),
        topic: z
          .string()
          .max(SESSION_TOPIC_MAX, { message: t('schedule.modal.validation.topicMax') })
          .optional(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, { message: t('schedule.modal.validation.dateRequired') }),
        startTime: z.string().regex(/^\d{2}:\d{2}$/, { message: t('schedule.modal.validation.timeRequired') }),
        durationMinutes: z
          .number({ message: t('schedule.modal.validation.durationRequired') })
          .int()
          .positive({ message: t('schedule.modal.validation.durationRequired') }),
        pattern: z.enum(RECURRENCE_PATTERNS),
        weekdays: z.array(z.number().int().min(0).max(6)),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')),
      })
      .superRefine((v, ctx) => {
        if (v.pattern === 'none') return
        if (!v.endDate) {
          ctx.addIssue({
            code: 'custom',
            path: ['endDate'],
            message: t('schedule.modal.validation.endDateRequired'),
          })
        }
        if ((v.pattern === 'weekly' || v.pattern === 'custom') && v.weekdays.length === 0) {
          ctx.addIssue({
            code: 'custom',
            path: ['weekdays'],
            message: t('schedule.modal.validation.weekdaysRequired'),
          })
        }
        // Catch endDate-before-start on the client too (the server also 422s it).
        if (v.endDate && v.endDate < v.date) {
          ctx.addIssue({
            code: 'custom',
            path: ['endDate'],
            message: t('schedule.modal.validation.endDateBeforeStart'),
          })
        }
      })
  }, [t])
}

export type SessionFormValues = z.infer<ReturnType<typeof useSessionSchema>>
