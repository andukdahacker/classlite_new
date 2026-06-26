/**
 * useResetPasswordSchema — Story 1-9b AC5.
 *
 * Builder-hook pattern per `useRegisterSchema` (Story 1-8) — Zod schema
 * built inside the component via `useMemo(t)` so locale switches
 * re-evaluate validation messages.
 *
 * Two fields — `newPassword` + `confirmPassword`. The `.refine(...)` on
 * equality emits the error onto `confirmPassword` via `path: ['confirmPassword']`
 * so the FormMessage renders inline below the confirm field, not as a
 * form-level error. Reuses `auth.common.validation.password*` keys
 * (passwordMin / passwordMax / passwordNotBlank) seeded by Story 1-8 +
 * the new `auth.resetPassword.error.passwordMismatch` key from this story.
 *
 * RHF wiring (Winston amendment 2026-06-26): consumers must set
 * `mode: 'onBlur'` AND `reValidateMode: 'onChange'`. The reValidateMode
 * is load-bearing: after the first blur, the refine re-runs on every
 * keystroke so editing `newPassword` AFTER both fields validated
 * immediately surfaces a mismatch on `confirmPassword`. Closes the
 * stale-refine inconsistency where the strength bar reacts live but
 * the match check waits for blur.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

export function useResetPasswordSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z
        .object({
          newPassword: z
            .string()
            .min(PASSWORD_MIN, {
              message: t('auth.common.validation.passwordMin'),
            })
            .max(PASSWORD_MAX, {
              message: t('auth.common.validation.passwordMax'),
            })
            // `passwordNotBlank` enforces ≥ PASSWORD_MIN non-whitespace
            // characters so a whitespace-padded value like `"        x"`
            // can't slip past the min-length check. Previously the regex
            // accepted any string with at least one non-whitespace
            // character; users could save passwords they'd be unable to
            // retype reliably
            // ([Review][Decision] D2 — code-review 2026-06-26).
            .refine((value) => value.trim().length >= PASSWORD_MIN, {
              message: t('auth.common.validation.passwordNotBlank'),
            }),
          confirmPassword: z.string().min(1, {
            message: t('auth.common.validation.passwordRequired'),
          }),
        })
        .refine((data) => data.newPassword === data.confirmPassword, {
          message: t('auth.resetPassword.error.passwordMismatch'),
          path: ['confirmPassword'],
        }),
    [t],
  )
}

export type ResetPasswordFormValues = z.infer<
  ReturnType<typeof useResetPasswordSchema>
>
