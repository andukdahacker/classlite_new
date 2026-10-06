/**
 * useChangePasswordSchema — Story 9.4 (AC4) change-password form.
 *
 * Builder-hook pattern per `useResetPasswordSchema` — built inside the
 * component via `useMemo(t)` so a locale switch re-evaluates messages. Three
 * fields: `currentPassword` (net-new vs reset), `newPassword`, `confirmPassword`.
 * Reuses the shared `auth.common.validation.password*` keys; the match refine
 * targets `confirmPassword`. Consumers set `mode: 'onBlur'` +
 * `reValidateMode: 'onChange'` (same as reset).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

export function useChangePasswordSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z
        .object({
          currentPassword: z.string().min(1, {
            message: t('profile.password.errors.currentRequired'),
          }),
          newPassword: z
            .string()
            .min(PASSWORD_MIN, {
              message: t('auth.common.validation.passwordMin'),
            })
            .max(PASSWORD_MAX, {
              message: t('auth.common.validation.passwordMax'),
            })
            .refine((value) => value.trim().length >= PASSWORD_MIN, {
              message: t('auth.common.validation.passwordNotBlank'),
            }),
          confirmPassword: z.string().min(1, {
            message: t('auth.common.validation.passwordRequired'),
          }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: t('profile.password.errors.mismatch'),
          path: ['confirmPassword'],
        }),
    [t],
  )
}

export type ChangePasswordFormValues = z.infer<
  ReturnType<typeof useChangePasswordSchema>
>
