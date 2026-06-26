/**
 * useForgotPasswordSchema — Story 1-9b AC3.
 *
 * Builder-hook pattern per `useRegisterSchema` / `useLoginSchema`
 * precedent (Story 1-8) — the Zod schema is built inside the component
 * via `useMemo(t)` so locale switches re-evaluate validation messages.
 *
 * Only one field — `email`. Reuses the `auth.common.validation.emailRequired`
 * and `auth.common.validation.emailFormat` keys seeded by Story 1-8.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export function useForgotPasswordSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        // Trim before length / format checks so password-manager pastes
        // with surrounding whitespace don't trip the `emailFormat` error
        // ([Review][Patch] P9 — code-review 2026-06-26).
        email: z
          .string()
          .transform((value) => value.trim())
          .pipe(
            z
              .string()
              .min(1, { message: t('auth.common.validation.emailRequired') })
              .pipe(
                z.email({ message: t('auth.common.validation.emailFormat') }),
              ),
          ),
      }),
    [t],
  )
}

export type ForgotPasswordFormValues = z.infer<
  ReturnType<typeof useForgotPasswordSchema>
>
