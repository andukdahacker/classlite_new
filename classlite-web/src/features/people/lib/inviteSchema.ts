/**
 * usePeopleInviteSchema — Story 7.1b (D11/AC16-18). Locale-reactive Zod builder
 * for the s41 staff-invite form (RHF + zodResolver), validating against the
 * generated `InviteStaffRequest` wire shape (D3 — never a hand-written type).
 *
 * Field validators mirror the shipped `useClassSchema` idiom (refine-based email
 * so we avoid zod v4's deprecated `.email()`; i18n messages resolved at build
 * time). `role` is Teacher | Admin ONLY — D12 (RULED Ducdo 2026-08-30) defers
 * Owner-invite to a future Settings surface, so no `owner` option exists. Empty
 * optional strings are treated as unset by the modal's payload builder so they
 * are sent as explicit `null` (TS-1) or omitted.
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

// Pragmatic email shape (matches the server's net/mail acceptance closely
// enough for form UX; the server is the authority). Mirrors classSchema.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const INVITE_ROLES = ['teacher', 'admin'] as const

export function usePeopleInviteSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        email: z
          .string()
          .transform((v) => v.trim())
          .refine((v) => v.length >= 1, {
            message: t('people.invite.error.emailRequired'),
          })
          .refine((v) => v === '' || EMAIL_RE.test(v), {
            message: t('people.invite.error.emailInvalid'),
          }),
        name: z.string().optional(),
        role: z.enum(INVITE_ROLES, {
          message: t('people.invite.error.roleRequired'),
        }),
        classId: z.string().nullable().optional(),
        welcomeNote: z.string().optional(),
      }),
    [t],
  )
}

export type PeopleInviteFormValues = z.infer<
  ReturnType<typeof usePeopleInviteSchema>
>
