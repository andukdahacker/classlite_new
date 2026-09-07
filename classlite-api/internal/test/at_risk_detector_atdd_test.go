// Story 7.2a (AC11/AC19 · D4 · risk=7) — the AtRiskDetector.Classify BOUNDARY
// table. Pure Go, NO DB: this is the service-seam unit that proves the three
// at-risk signals + the Good/Normal split independent of query wiring. The
// ★ risk-driver: at-risk mis-classification is a visible product lie, and the
// window/consecutive/drop logic false-greens trivially — so every threshold is
// pinned at its in/out boundary here, once, in isolation.
//
// RED (`//go:build atdd_red_phase`, quarantined): compile-fails on the GREENFIELD
// service seams only — service.NewAtRiskDetector / AtRiskInputs / AtRiskResult /
// (*AtRiskDetector).Classify and the exported threshold constants. Task 4 builds
// internal/service/at_risk_detector.go; de-tag when green.
//
// GREEN SEAMS (dev — Task 4 internal/service/at_risk_detector.go):
//
//	const (
//	    AtRiskAttendanceFloor    = 0.70 // attendance ratio strictly BELOW → tripped
//	    AtRiskConsecutiveMissed  = 2    // leading run of most-recent past-due misses AT/ABOVE → tripped
//	    AtRiskGradedWindow       = 4    // need ≥4 released grades for the drop signal
//	    AtRiskBandDropDelta      = 1.0  // first(of last-4) − last(of last-4) AT/ABOVE → tripped
//	    OverallBandWindow        = 5
//	)
//	type AtRiskInputs struct {
//	    AttendancePresentLate int       // present+late count over caller-visible sessions
//	    AttendanceTotalMarked int       // total attendance rows marked (0 ⇒ signal NOT evaluable)
//	    ConsecutiveMissed     int        // leading run length of most-recent past-due assignments with no submission
//	    RecentReleasedBands   []float64  // released overall_band, CHRONOLOGICAL (oldest→newest); last-4 drive the drop signal
//	    OverallBand           *float64   // avg of last OverallBandWindow released; nil ⇒ no grades
//	    ClassTargetBand       *float64   // class target_band for the Good/Normal split; nil ⇒ no target
//	}
//	type AtRiskResult struct { Status string; Reasons []string } // Status ∈ {"good","normal","at_risk"}
//	func NewAtRiskDetector(clk clock.Clock) *AtRiskDetector
//	func (*AtRiskDetector) Classify(in AtRiskInputs) AtRiskResult
//
//	Reason slugs (stable): "attendance_below_floor" · "consecutive_missed" · "band_drop".
//	Rule: at_risk if ANY signal trips; else "good" iff OverallBand!=nil && ClassTargetBand!=nil
//	&& *OverallBand>=*ClassTargetBand; else "normal". Insufficient data never trips a signal
//	(TotalMarked==0 → no attendance signal; len(RecentReleasedBands)<4 → no drop signal).
package test

import (
	"testing"
	"time"

	"github.com/ducdo/classlite-api/internal/clock"
	"github.com/ducdo/classlite-api/internal/service"
)

func fp(v float64) *float64 { return &v }

func newDetector() *service.AtRiskDetector {
	// Clock injected per D4 (the detector owns wall-time for any gather helper);
	// Classify itself is pure over inputs, so the anchor is immaterial here.
	return service.NewAtRiskDetector(clock.NewMockClock(time.Date(2026, 9, 6, 12, 0, 0, 0, time.UTC)))
}

func hasReason(rs []string, want string) bool {
	for _, r := range rs {
		if r == want {
			return true
		}
	}
	return false
}

func TestAtRiskDetector_Classify_BoundaryTable_ATDD(t *testing.T) {
	target := fp(6.5)
	cases := []struct {
		name        string
		in          service.AtRiskInputs
		wantStatus  string
		wantReason  string // "" ⇒ assert NO at-risk reason
	}{
		// ---- Attendance floor (strictly below 0.70) ----
		{"attendance 0.69 → at_risk", service.AtRiskInputs{AttendancePresentLate: 69, AttendanceTotalMarked: 100, OverallBand: fp(7.0), ClassTargetBand: target}, "at_risk", "attendance_below_floor"},
		{"attendance 0.70 exactly → NOT tripped", service.AtRiskInputs{AttendancePresentLate: 70, AttendanceTotalMarked: 100, OverallBand: fp(7.0), ClassTargetBand: target}, "good", ""},
		{"attendance total_marked=0 → not evaluable, NOT tripped", service.AtRiskInputs{AttendancePresentLate: 0, AttendanceTotalMarked: 0, OverallBand: fp(7.0), ClassTargetBand: target}, "good", ""},

		// ---- Consecutive missed (leading run ≥ 2) ----
		{"exactly 2 consecutive misses → at_risk", service.AtRiskInputs{ConsecutiveMissed: 2, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(7.0), ClassTargetBand: target}, "at_risk", "consecutive_missed"},
		{"1 miss → NOT tripped", service.AtRiskInputs{ConsecutiveMissed: 1, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(7.0), ClassTargetBand: target}, "good", ""},
		{"0 misses (no past-due) → NOT tripped", service.AtRiskInputs{ConsecutiveMissed: 0, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(7.0), ClassTargetBand: target}, "good", ""},

		// ---- Band drop over last 4 (first−last ≥ 1.0) ----
		{"drop exactly 1.0 over last-4 → at_risk", service.AtRiskInputs{RecentReleasedBands: []float64{7.0, 6.5, 6.5, 6.0}, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(6.5), ClassTargetBand: target}, "at_risk", "band_drop"},
		{"drop 0.9 over last-4 → NOT tripped", service.AtRiskInputs{RecentReleasedBands: []float64{6.9, 6.5, 6.2, 6.0}, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(6.4), ClassTargetBand: target}, "normal", ""},
		{"only 3 released grades → drop NOT evaluable", service.AtRiskInputs{RecentReleasedBands: []float64{8.0, 7.0, 6.0}, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(7.0), ClassTargetBand: target}, "good", ""},
		{"last-4 window only (early dip recovered) → NOT tripped", service.AtRiskInputs{RecentReleasedBands: []float64{8.0, 5.0, 6.5, 6.5, 6.5}, AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(6.5), ClassTargetBand: target}, "good", ""},

		// ---- Good/Normal split (no signal tripped) ----
		{"band ≥ target → good", service.AtRiskInputs{AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(6.5), ClassTargetBand: target}, "good", ""},
		{"band < target → normal", service.AtRiskInputs{AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(6.0), ClassTargetBand: target}, "normal", ""},
		{"no band at all → normal (not good)", service.AtRiskInputs{AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: nil, ClassTargetBand: target}, "normal", ""},
		{"no class target → normal even with high band", service.AtRiskInputs{AttendanceTotalMarked: 10, AttendancePresentLate: 10, OverallBand: fp(8.0), ClassTargetBand: nil}, "normal", ""},
	}

	d := newDetector()
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := d.Classify(tc.in)
			if got.Status != tc.wantStatus {
				t.Fatalf("status: got %q, want %q (reasons=%v)", got.Status, tc.wantStatus, got.Reasons)
			}
			if tc.wantReason != "" && !hasReason(got.Reasons, tc.wantReason) {
				t.Fatalf("expected reason %q in %v", tc.wantReason, got.Reasons)
			}
			if tc.wantStatus != "at_risk" && len(got.Reasons) != 0 {
				t.Fatalf("non-at-risk must carry no reasons, got %v", got.Reasons)
			}
		})
	}
}

// AC11 — multiple signals trip together: reasons[] names EACH tripped signal.
func TestAtRiskDetector_Classify_MultipleReasons_ATDD(t *testing.T) {
	d := newDetector()
	got := d.Classify(service.AtRiskInputs{
		AttendancePresentLate: 5, AttendanceTotalMarked: 10, // 0.50 < 0.70
		ConsecutiveMissed:   3,                                  // ≥ 2
		RecentReleasedBands: []float64{7.5, 7.0, 6.5, 6.0},      // drop 1.5 ≥ 1.0
		OverallBand:         fp(6.0), ClassTargetBand: fp(6.5),
	})
	if got.Status != "at_risk" {
		t.Fatalf("status: got %q, want at_risk", got.Status)
	}
	for _, want := range []string{"attendance_below_floor", "consecutive_missed", "band_drop"} {
		if !hasReason(got.Reasons, want) {
			t.Errorf("missing reason %q in %v", want, got.Reasons)
		}
	}
}
