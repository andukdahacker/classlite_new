// Story 3.4 — recurrence generator unit table (Task 6). Pure function, no DB.
// Covers none/daily/weekly/custom/multi-weekday, endDate inclusivity, and the
// 200-cap overflow (one-past detection).
package service

import (
	"testing"
	"time"
)

func date(y int, m time.Month, d, hh, mm int) time.Time {
	return time.Date(y, m, d, hh, mm, 0, 0, time.UTC)
}

func TestGenerateOccurrences(t *testing.T) {
	start := date(2026, 8, 3, 9, 0) // 2026-08-03 is a Monday
	tests := []struct {
		name    string
		spec    RecurrenceSpec
		wantLen int
		checkFn func(t *testing.T, occ []time.Time)
	}{
		{
			name:    "none → single occurrence",
			spec:    RecurrenceSpec{Pattern: recurrenceNone},
			wantLen: 1,
			checkFn: func(t *testing.T, occ []time.Time) {
				if !occ[0].Equal(start) {
					t.Errorf("occ[0]=%v, want %v", occ[0], start)
				}
			},
		},
		{
			name:    "daily inclusive of endDate",
			spec:    RecurrenceSpec{Pattern: recurrenceDaily, EndDate: date(2026, 8, 7, 0, 0)},
			wantLen: 5, // 03,04,05,06,07
			checkFn: func(t *testing.T, occ []time.Time) {
				// Occurrences are materialized in the app zone (CR-3-4 P6), so
				// assert the invariant that holds regardless of representation:
				// the first occurrence is the start instant, and each subsequent
				// day preserves time-of-day (exactly +24h, no-DST app zone).
				if !occ[0].Equal(start) {
					t.Errorf("daily occ[0] instant changed: %v, want %v", occ[0], start)
				}
				for i := 1; i < len(occ); i++ {
					if occ[i].Sub(occ[i-1]) != 24*time.Hour {
						t.Errorf("daily occ[%d]=%v not +24h from previous", i, occ[i])
					}
				}
			},
		},
		{
			name:    "weekly defaults to start weekday (Mon)",
			spec:    RecurrenceSpec{Pattern: recurrenceWeekly, EndDate: date(2026, 8, 24, 0, 0)},
			wantLen: 4, // Mondays 03,10,17,24
			checkFn: func(t *testing.T, occ []time.Time) {
				for _, o := range occ {
					if o.Weekday() != time.Monday {
						t.Errorf("weekly produced non-Monday %v", o)
					}
				}
			},
		},
		{
			name:    "custom multi-weekday (Mon+Wed)",
			spec:    RecurrenceSpec{Pattern: recurrenceCustom, Weekdays: []int{1, 3}, EndDate: date(2026, 8, 14, 0, 0)},
			wantLen: 4, // Mon 03, Wed 05, Mon 10, Wed 12
		},
		{
			name:    "endDate before start → empty",
			spec:    RecurrenceSpec{Pattern: recurrenceDaily, EndDate: date(2026, 8, 1, 0, 0)},
			wantLen: 0,
		},
		{
			name:    "cap overflow → one past the cap",
			spec:    RecurrenceSpec{Pattern: recurrenceDaily, EndDate: date(2028, 1, 1, 0, 0)},
			wantLen: maxRecurrenceOccurrences + 1,
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			occ := generateOccurrences(start, tt.spec)
			if len(occ) != tt.wantLen {
				t.Fatalf("len(occ)=%d, want %d", len(occ), tt.wantLen)
			}
			if tt.checkFn != nil {
				tt.checkFn(t, occ)
			}
		})
	}
}

func TestGenerateOccurrences_Weekly31Aug(t *testing.T) {
	// 2026-08-31 is a Monday — confirm the weekly count includes it.
	start := date(2026, 8, 3, 9, 0)
	occ := generateOccurrences(start, RecurrenceSpec{Pattern: recurrenceWeekly, EndDate: date(2026, 8, 31, 0, 0)})
	if len(occ) != 5 {
		t.Fatalf("Mondays 03,10,17,24,31 → want 5, got %d (%v)", len(occ), occ)
	}
}
