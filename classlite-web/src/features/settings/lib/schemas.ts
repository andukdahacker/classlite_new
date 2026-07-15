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

// -----------------------------------------------------------------------------
// Story 2-5b — terms + holidays + rooms Zod schemas.
// Message strings are i18n keys resolved via `t(msg)` at render time.
// -----------------------------------------------------------------------------

const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/

// Shared date validator across terms + holidays. Emits a generic invalid-
// date key so the error copy matches the failing field's label regardless
// of which form site the ISO date lives on. Amended /bmad-code-review 2-5b
// Round 1 P8 (2026-07-15) — previously used
// `settings.terms.form.startDate.label` as the error message, which rendered
// the field LABEL ("Start date") in place of the diagnostic text and cross-
// scoped the terms.* namespace into holidays validation.
const isoDate = z
  .string()
  .regex(DATE_REGEX, { message: 'settings.common.form.date.errors.invalid' })

export const termSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, { message: 'settings.terms.form.name.errors.required' })
      .max(120, { message: 'settings.terms.form.name.errors.tooLong' }),
    startDate: isoDate,
    endDate: isoDate,
    sessionCount: z.number().int().min(1).nullable().optional(),
  })
  .refine((v) => v.endDate >= v.startDate, {
    path: ['endDate'],
    message: 'settings.terms.form.endDate.errors.beforeStart',
  })

export type TermFormValues = z.infer<typeof termSchema>

export const DEFAULT_TERM_FORM_VALUES: TermFormValues = {
  name: '',
  startDate: '',
  endDate: '',
  sessionCount: null,
}

export const holidaySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'settings.holidays.form.name.errors.required' })
    .max(120, { message: 'settings.holidays.form.name.errors.tooLong' }),
  date: isoDate,
})

export type HolidayFormValues = z.infer<typeof holidaySchema>

export const DEFAULT_HOLIDAY_FORM_VALUES: HolidayFormValues = {
  name: '',
  date: '',
}

export const roomSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { message: 'settings.rooms.form.name.errors.required' })
    .max(80, { message: 'settings.rooms.form.name.errors.tooLong' }),
  description: z
    .string()
    .trim()
    .max(240, { message: 'settings.rooms.form.description.errors.tooLong' })
    .or(z.literal('')),
  // Every capacity path emits the same range copy so RHF's valueAsNumber
  // conversion edge cases (empty → NaN, number > max) all surface as one
  // error message the user can act on.
  capacity: z
    .number({ message: 'settings.rooms.form.capacity.errors.range' })
    .int({ message: 'settings.rooms.form.capacity.errors.range' })
    .min(1, { message: 'settings.rooms.form.capacity.errors.range' })
    .max(500, { message: 'settings.rooms.form.capacity.errors.range' }),
})

export type RoomFormValues = z.infer<typeof roomSchema>

export const DEFAULT_ROOM_FORM_VALUES: RoomFormValues = {
  name: '',
  description: '',
  capacity: 20,
}

export type { SupportedTimezone }
