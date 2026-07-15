/**
 * Story 2-5a — IANA timezone whitelist (30 entries).
 *
 * Duplicated in Go at `classlite-api/internal/service/settings_timezone.go`.
 * `settings_timezone_parity_test.go` regex-extracts both files at CI time
 * and asserts identical sets — never edit one without editing the other.
 * Order: VN default first, then rest of Asia, then Europe, Americas, Oceania.
 */
export const TIMEZONE_WHITELIST = [
  "Asia/Ho_Chi_Minh",
  "Asia/Bangkok",
  "Asia/Singapore",
  "Asia/Jakarta",
  "Asia/Manila",
  "Asia/Kuala_Lumpur",
  "Asia/Hong_Kong",
  "Asia/Shanghai",
  "Asia/Taipei",
  "Asia/Seoul",
  "Asia/Tokyo",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Karachi",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Europe/Madrid",
  "Europe/Warsaw",
  "Europe/Moscow",
  "Europe/Istanbul",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

export type SupportedTimezone = (typeof TIMEZONE_WHITELIST)[number];

export const DEFAULT_TIMEZONE: SupportedTimezone = "Asia/Ho_Chi_Minh";

const supportedSet = new Set<string>(TIMEZONE_WHITELIST);

export function isSupportedTimezone(tz: string): tz is SupportedTimezone {
  return supportedSet.has(tz);
}
