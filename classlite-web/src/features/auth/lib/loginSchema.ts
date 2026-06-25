/**
 * useLoginSchema — Story 1-8 AC4.
 *
 * Builder-hook pattern per Form.stories.tsx:52-72 — the Zod schema is
 * built inside the component via `useMemo(t)` so locale switches
 * re-evaluate validation messages (module-load `i18n.t()` would snapshot
 * the bootup locale and stay frozen — Murat #2 / Amelia #3 amendment).
 *
 * Login deliberately uses `min(1)` not `min(8)` — never reveal the
 * password-policy length on the login form per SEC-1 (a length-aware
 * "min 8" message lets unknown-password attackers map valid-format
 * probes). The error copy is `validation.passwordRequired` ("Password
 * is required"), NOT `validation.passwordMin`.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

export function useLoginSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        email: z
          .string()
          .min(1, { message: t('auth.common.validation.emailRequired') })
          .pipe(
            z.email({ message: t('auth.common.validation.emailFormat') }),
          ),
        password: z
          .string()
          .min(1, { message: t('auth.common.validation.passwordRequired') }),
        rememberMe: z.boolean(),
      }),
    [t],
  )
}

export type LoginFormValues = z.infer<ReturnType<typeof useLoginSchema>>
