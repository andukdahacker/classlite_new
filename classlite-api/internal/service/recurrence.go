// Story 3.4 — recurrence engine. Pure occurrence generator: given a first
// start time, a pattern, an optional weekday set, and an inclusive end date, it
// materializes the list of concrete start times. No DB, no clock — fully
// unit-testable (Task 6 table). The service persists one row per returned time,
// all sharing one recurrence_group_id (materialize-on-create, not a stored
// RRULE). Editing the pattern / moving out of the series is out of scope.
package service

import "time"

const (
	// maxRecurrenceOccurrences bounds a single materialized series (Winston).
	maxRecurrenceOccurrences = 200
	// appScheduleTZ is the single v1 authoring/rendering zone. recurrence_tz is
	// stamped from it; per-center TZ rendering is a follow-up.
	appScheduleTZ = "Asia/Ho_Chi_Minh"

	recurrenceNone   = "none"
	recurrenceDaily  = "daily"
	recurrenceWeekly = "weekly"
	recurrenceCustom = "custom"

	// scheduleUTCOffsetSeconds is the fixed offset of appScheduleTZ. The v1 app
	// zone has no DST, so a FixedZone is exact and avoids a tzdata dependency.
	scheduleUTCOffsetSeconds = 7 * 60 * 60
)

// scheduleLocation is the app authoring/rendering zone as a fixed-offset
// location. Day boundaries and weekday membership are computed here so a client
// that sends startsAt in UTC (or any other offset) still materializes on the
// intended Asia/Ho_Chi_Minh calendar (CR-3-4 P5/P6).
var scheduleLocation = time.FixedZone(appScheduleTZ, scheduleUTCOffsetSeconds)

// ScheduleLocation returns the app authoring/rendering zone. The handler uses it
// to anchor the [from, to) list window to local calendar days.
func ScheduleLocation() *time.Location { return scheduleLocation }

// RecurrenceSpec is the decoded, validated recurrence intent.
type RecurrenceSpec struct {
	Pattern  string    // none | daily | weekly | custom
	Weekdays []int     // 0=Sun … 6=Sat (weekly/custom)
	EndDate  time.Time // inclusive; midnight of the last eligible day (unused for none)
}

// generateOccurrences returns the concrete start times for spec, beginning at
// start (which is itself the first candidate). Whole calendar days are added to
// start so each occurrence keeps start's time-of-day (single-TZ, no DST — the
// app zone has none). For weekly/custom, a day is included iff its weekday is in
// the set; an empty set defaults to start's own weekday. Generation stops one
// past the cap so the caller can detect an over-limit request and report the
// furthest reachable date.
func generateOccurrences(start time.Time, spec RecurrenceSpec) []time.Time {
	if spec.Pattern == recurrenceNone {
		return []time.Time{start}
	}

	// Anchor day-stepping and weekday checks to the app zone regardless of the
	// offset the client sent startsAt in (CR-3-4 P6). Same instant, app-local
	// wall clock; no-DST FixedZone keeps time-of-day stable across AddDate.
	start = start.In(scheduleLocation)

	weekdaySet := map[time.Weekday]bool{}
	for _, w := range spec.Weekdays {
		weekdaySet[time.Weekday(((w%7)+7)%7)] = true
	}
	if len(weekdaySet) == 0 && (spec.Pattern == recurrenceWeekly || spec.Pattern == recurrenceCustom) {
		weekdaySet[start.Weekday()] = true
	}

	// Exclusive upper bound: the day AFTER EndDate at start's time-of-day.
	limit := time.Date(spec.EndDate.Year(), spec.EndDate.Month(), spec.EndDate.Day(),
		start.Hour(), start.Minute(), start.Second(), start.Nanosecond(), start.Location()).
		AddDate(0, 0, 1)

	var out []time.Time
	for day := start; day.Before(limit); day = day.AddDate(0, 0, 1) {
		switch spec.Pattern {
		case recurrenceDaily:
			out = append(out, day)
		case recurrenceWeekly, recurrenceCustom:
			if weekdaySet[day.Weekday()] {
				out = append(out, day)
			}
		}
		if len(out) > maxRecurrenceOccurrences {
			break // one past the cap — the caller detects the overflow
		}
	}
	return out
}
