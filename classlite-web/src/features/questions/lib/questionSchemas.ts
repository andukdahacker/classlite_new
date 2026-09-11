/**
 * questionSchemas — locale-reactive Zod builders for the Q&A composer forms
 * (Story 7.4b, AC3/AC8/AC10/AC15). RHF + zodResolver (FW-8); form shapes are
 * zod-inferred and DISTINCT from the generated wire types (TS-2). Messages
 * resolve to i18n keys. The anchor scope + selected-question ids live in
 * component state, not the form — these schemas bound only the free text +
 * visibility toggle.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { QUESTION_CONTENT_MAX } from '@/components/domain/AnchoredQuestionCard'

// Re-exported so the composer textareas + the Zod `.max()` share the one
// contract literal (single source lives in the domain card).
export { QUESTION_CONTENT_MAX }
export const QUESTION_VISIBILITIES = ['personal', 'shared'] as const
export type QuestionVisibilityForm = (typeof QUESTION_VISIBILITIES)[number]

/** Ask composer (student, AC3) — content only; anchor is chosen separately. */
export function useAskComposerSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        content: z
          .string()
          .trim()
          .min(1, { message: t('questions.composer.validation.contentRequired') })
          .max(QUESTION_CONTENT_MAX, {
            message: t('questions.composer.validation.contentMax'),
          }),
      }),
    [t],
  )
}

export type AskComposerValues = z.infer<ReturnType<typeof useAskComposerSchema>>

/** Reply / batch-reply composer (teacher, AC8/AC10) — content + visibility. */
export function useReplyComposerSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        content: z
          .string()
          .trim()
          .min(1, { message: t('questions.composer.validation.contentRequired') })
          .max(QUESTION_CONTENT_MAX, {
            message: t('questions.composer.validation.contentMax'),
          }),
        visibility: z.enum(QUESTION_VISIBILITIES, {
          message: t('questions.composer.validation.visibilityRequired'),
        }),
      }),
    [t],
  )
}

export type ReplyComposerValues = z.infer<
  ReturnType<typeof useReplyComposerSchema>
>
