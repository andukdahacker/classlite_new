/**
 * Story 2-5a — hand-authored Zod schemas for the Settings Profile form.
 *
 * openapi-zod-client is TODO'd (see `scripts/codegen.sh:16-24`); FU-2-5-J
 * files the generated-Zod migration. Until then, this file is the source
 * of truth for form validation. Constraints mirror
 * `api.yaml#UpdateCenterProfileRequest` verbatim:
 *   - name: 1..120 chars
 *   - contactEmail: RFC 5322 email OR empty (empty = "clear to NULL"
 *     wire-side per D4; the mutation serializes empty to explicit JSON
 *     null so the backend NULLs the column).
 *   - brandColor: `#RGB` / `#RRGGBB` hex OR empty (empty = clear-to-NULL)
 *   - timezone: one of TIMEZONE_WHITELIST
 *
 * shortCode is intentionally absent — the field is rendered read-only
 * (AC3) and never included in submit payloads.
 */
import { z } from 'zod'
import {
  DEFAULT_TIMEZONE,
  TIMEZONE_WHITELIST,
  type SupportedTimezone,
} from './timezoneWhitelist'

// z.literal(union) preserves literal types across every entry, so
// z.infer<...> returns SupportedTimezone (not widened `string`). Lines
// up with `components['schemas']['UpdateCenterProfileRequest']['timezone']`
// at the mutate call.
const timezoneEnum = z.literal(TIMEZONE_WHITELIST)

// D1 (2026-07-15 review): validate free-form hex input so the swatch
// picker and the hex input share a single source of truth. Accepts 3-
// and 6-digit hex; case-insensitive.
const HEX_COLOR_REGEX = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export const centerSettingsProfileSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'settings.profile.form.name.errors.required' })
    .max(120, { message: 'settings.profile.form.name.errors.tooLong' }),
  contactEmail: z
    .email({ message: 'settings.profile.form.contactEmail.errors.invalid' })
    .or(z.literal('')),
  brandColor: z
    .string()
    .trim()
    .regex(HEX_COLOR_REGEX, {
      message: 'settings.profile.form.brandColor.errors.invalid',
    })
    .or(z.literal('')),
  timezone: timezoneEnum,
})

export type CenterSettingsProfileFormValues = z.infer<
  typeof centerSettingsProfileSchema
>

export const DEFAULT_PROFILE_FORM_VALUES: CenterSettingsProfileFormValues = {
  name: '',
  contactEmail: '',
  brandColor: '',
  timezone: DEFAULT_TIMEZONE,
}

export type { SupportedTimezone }
