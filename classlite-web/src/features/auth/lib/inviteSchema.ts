/**
 * useInviteSchema — Story 1-9c AC4 / Task 3.1.
 *
 * Builder-hook pattern mirroring useRegisterSchema. Zod schema is built
 * inside the component via `useMemo(t)` so locale switches re-evaluate
 * validation messages.
 *
 * Email is intentionally NOT in the schema — the backend authoritatively
 * uses `invite.email` from the token row (anti-enumeration; mirrors
 * Story 1-6's redirect privacy contract).
 *
 * Password not-blank refinement (1-9b code-review P9 — `.regex(/\S/)`)
 * rejects all-whitespace passwords without disallowing passphrase spaces.
 *
 * The fullName error message uses `auth.invite.error.fullNameRequired`
 * (page-scoped per AC3) so the invite copy reads consistently with the
 * H1 / CTA wording. Password validation reuses the shared
 * `auth.common.validation.password*` keys.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

const FULL_NAME_MAX = 200
const PASSWORD_MIN = 8
const PASSWORD_MAX = 72

export function useInviteSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        fullName: z
          .string()
          .min(1, { message: t('auth.invite.error.fullNameRequired') })
          .max(FULL_NAME_MAX, {
            message: t('auth.common.validation.fullNameMax'),
          })
          // `.regex(/\S/)` rejects all-whitespace input without disallowing
          // passphrase spaces. Mirrors the registerSchema/loginSchema
          // ZodString chain — avoids the ZodEffects wrapping that `.refine`
          // introduces and that zodResolver doesn't attach to the field
          // path cleanly on submit.
          .regex(/\S/, {
            message: t('auth.invite.error.fullNameRequired'),
          }),
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

export type InviteFormValues = z.infer<ReturnType<typeof useInviteSchema>>
