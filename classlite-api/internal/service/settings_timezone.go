// Story 2-5a — server-side timezone whitelist.
//
// Kept in this file (not in a data package) so the parity test at
// settings_timezone_parity_test.go can regex-extract the Go literal and
// compare to the TS whitelist at
// classlite-web/src/features/settings/lib/timezoneWhitelist.ts.
//
// Duplication is intentional per Winston-S8 fold: 30 items × 2 languages
// is cheap; drift is caught by the parity test at CI time. Never edit one
// list without editing the other in the same commit.
package service

// SupportedTimezones is the 30-entry IANA allowlist accepted by
// PATCH /api/centers/{id}. Anything else returns 422 UNSUPPORTED_TIMEZONE.
// Order: VN default first, then rest of Asia, then Europe, Americas, Oceania.
var SupportedTimezones = []string{
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
}

// supportedTimezoneSet is the O(1) membership index derived from the list.
var supportedTimezoneSet = func() map[string]struct{} {
	m := make(map[string]struct{}, len(SupportedTimezones))
	for _, tz := range SupportedTimezones {
		m[tz] = struct{}{}
	}
	return m
}()

// isSupportedTimezone reports whether tz is one of the whitelisted IANA zones.
func isSupportedTimezone(tz string) bool {
	_, ok := supportedTimezoneSet[tz]
	return ok
}
