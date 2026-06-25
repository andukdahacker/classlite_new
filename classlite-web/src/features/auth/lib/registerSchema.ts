/**
 * useRegisterSchema — Story 1-8 AC3.
 *
 * Builder-hook pattern per Form.stories.tsx:52-72 — Zod schema built
 * inside the component via `useMemo(t)` so locale switches re-evaluate
 * validation messages.
 *
 * Password not-blank refinement (code-review P9 2026-06-25): a string of
 * pure whitespace passes `.min(8)` length but is trivially guessable. The
 * `.regex(/\S/)` check rejects all-whitespace input without rejecting
 * passwords that happen to contain spaces (which IS allowed — e.g. a
 * passphrase).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

const FULL_NAME_MAX = 200
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

export function useRegisterSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        fullName: z
          .string()
          .min(1, { message: t('auth.common.validation.fullNameRequired') })
          .max(FULL_NAME_MAX, {
            message: t('auth.common.validation.fullNameMax'),
          }),
        email: z
          .string()
          .min(1, { message: t('auth.common.validation.emailRequired') })
          .pipe(
            z.email({ message: t('auth.common.validation.emailFormat') }),
          ),
        password: z
          .string()
          .min(PASSWORD_MIN, {
            message: t('auth.common.validation.passwordMin'),
          })
          .max(PASSWORD_MAX, {
            message: t('auth.common.validation.passwordMax'),
          })
          .regex(/\S/, {
            message: t('auth.common.validation.passwordNotBlank'),
          }),
      }),
    [t],
  )
}

export type RegisterFormValues = z.infer<ReturnType<typeof useRegisterSchema>>
