/**
 * useCenterSetupSchema — Story 2-3a AC5, Task 2.2.
 *
 * Zod builder-hook for the center-setup form fields. Locale-reactive via
 * `useMemo(t)` (mirrors `useRegisterSchema`).
 *
 * Rune-vs-byte length: JS `.length` counts UTF-16 code units, which under-counts
 * Vietnamese diacritics and over-counts emoji surrogate pairs. `.refine` with
 * `centerNameRuneLength` mirrors Story 2.1's `utf8.RuneCountInString` fix so
 * client + server measure the same 60-rune ceiling.
 *
 * `CENTER_NAME_REGEX` is sourced from `@/lib/centerName` (Amelia-B1 fold — the
 * regex lives outside the auth feature so onboarding can consume it without a
 * TS-7 cross-feature import).
 */
import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import {
  CENTER_NAME_MAX_RUNES,
  CENTER_NAME_REGEX,
  centerNameRuneLength,
} from '@/lib/centerName'

// The six brand-color hex values are the wire-format contract with the API
// (`POST /api/centers` accepts `brandColor` as a literal hex string, and
// `CreateCenterResult.brandColor` echoes it back). They cannot flow through
// `--cl-*` design tokens without a schema/OpenAPI amendment. FU-2-3a-C
// tracks namespacing these as `--cl-brand-*` tokens post-designer review.
/* eslint-disable no-restricted-syntax -- brand-color wire values (FU-2-3a-C) */
export const BRAND_COLOR_VALUES = [
  '#1e3a8a', // deep navy (default)
  '#d97706', // amber
  '#166534', // green
  '#991b1b', // red
  '#b45309', // brown
  '#6b6f7a', // gray
] as const
/* eslint-enable no-restricted-syntax */

export type BrandColorValue = (typeof BRAND_COLOR_VALUES)[number]

export const DEFAULT_BRAND_COLOR: BrandColorValue = BRAND_COLOR_VALUES[0]

export function useCenterSetupSchema() {
  const { t } = useTranslation()
  return useMemo(
    () =>
      z.object({
        name: z
          .string()
          .refine((v) => v.trim().length > 0, {
            message: t('onboarding.center.error.nameRequired'),
          })
          .refine((v) => centerNameRuneLength(v) <= CENTER_NAME_MAX_RUNES, {
            message: t('onboarding.center.error.nameMax', {
              max: CENTER_NAME_MAX_RUNES,
            }),
          })
          .refine(
            (v) => v.trim().length === 0 || CENTER_NAME_REGEX.test(v.trim()),
            { message: t('onboarding.center.error.nameInvalid') },
          ),
        brandColor: z.enum(BRAND_COLOR_VALUES, {
          // R1-P28: dedicated key so a tampered enum value does not surface
          // the name-invalid copy (unreachable under UI defaults but latent
          // via API mutation).
          message: t('onboarding.center.error.brandColorInvalid'),
        }),
      }),
    [t],
  )
}

export type CenterSetupFormValues = z.infer<
  ReturnType<typeof useCenterSetupSchema>
>
