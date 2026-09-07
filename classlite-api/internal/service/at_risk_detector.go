// Package service — Story 7.2a AtRiskDetector (D4). The clock-injected at-risk
// classifier: a pure function over inputs the roster/detail queries supply as
// columns, so the roster classifies the whole page set-based with NO per-row N+1.
//
// Three signals, any one trips `at_risk` (thresholds are named constants, CQ-3 —
// the single source of truth; the SQL window sizes in queries/students.sql are
// documented to mirror OverallBandWindow / AtRiskGradedWindow):
//
//  1. Attendance floor  — (present+late)/total_marked STRICTLY below
//     AtRiskAttendanceFloor. total_marked==0 ⇒ not evaluable (insufficient data).
//  2. Consecutive missed — the leading run of most-recent past-due assignments
//     with no submission AT/ABOVE AtRiskConsecutiveMissed.
//  3. Band drop         — over the last AtRiskGradedWindow released grades
//     (chronological oldest→newest), first − last AT/ABOVE AtRiskBandDropDelta
//     (a downward slide, not volatility). Fewer than the window ⇒ not evaluable.
//
// No signal tripped → "good" iff a band exists AND meets the class target, else
// "normal". Insufficient data never trips a signal. Reason slugs are stable
// (attachments for the FE StatusPill/PerfPill): attendance_below_floor,
// consecutive_missed, band_drop.
package service

import "github.com/ducdo/classlite-api/internal/clock"

// At-risk classification thresholds (CQ-3 — no magic values; the one source of
// truth for the derivation windows the SQL mirrors).
const (
	// AtRiskAttendanceFloor is the attendance ratio strictly BELOW which the
	// attendance signal trips.
	AtRiskAttendanceFloor = 0.70
	// AtRiskConsecutiveMissed is the leading-run length of most-recent past-due
	// misses at or above which the consecutive-missed signal trips.
	AtRiskConsecutiveMissed = 2
	// AtRiskGradedWindow is the number of most-recent released grades the band-drop
	// signal considers (and the minimum needed to evaluate it).
	AtRiskGradedWindow = 4
	// AtRiskBandDropDelta is the first-minus-last drop across the window at or
	// above which the band-drop signal trips.
	AtRiskBandDropDelta = 1.0
	// OverallBandWindow is how many most-recent released grades feed overallBand.
	OverallBandWindow = 5
)

// At-risk status values (D4). The FE PerfPill renders good / normal / at_risk.
const (
	AtRiskStatusGood   = "good"
	AtRiskStatusNormal = "normal"
	AtRiskStatusAtRisk = "at_risk"
)

// At-risk reason slugs (stable — the FE routes on these, not prose).
const (
	AtRiskReasonAttendance  = "attendance_below_floor"
	AtRiskReasonConsecutive = "consecutive_missed"
	AtRiskReasonBandDrop    = "band_drop"
)

// AtRiskInputs is the per-student input the roster/detail queries supply. All
// window/consecutive math is done in SQL (bound to the injected clock); the
// detector is a pure threshold classifier over these columns.
type AtRiskInputs struct {
	// AttendancePresentLate is present+late over the caller-visible sessions.
	AttendancePresentLate int
	// AttendanceTotalMarked is the total attendance rows marked (0 ⇒ the
	// attendance signal is not evaluable).
	AttendanceTotalMarked int
	// ConsecutiveMissed is the leading run of most-recent past-due assignments
	// with no submission.
	ConsecutiveMissed int
	// RecentReleasedBands are the released overall_band values, CHRONOLOGICAL
	// (oldest→newest); the last AtRiskGradedWindow drive the drop signal.
	RecentReleasedBands []float64
	// OverallBand is the avg of the last OverallBandWindow released grades; nil
	// when the student has no released grades.
	OverallBand *float64
	// ClassTargetBand is the class target for the Good/Normal split; nil when no
	// enrolled class carries a target.
	ClassTargetBand *float64
}

// AtRiskResult is the classification. Status ∈ {good, normal, at_risk}; Reasons
// names each tripped signal (empty unless Status == at_risk).
type AtRiskResult struct {
	Status  string
	Reasons []string
}

// AtRiskDetector classifies students. The injected clock is the wall-time source
// for any gather helper; Classify itself is pure over its inputs (the SQL that
// builds the inputs is what consumes the bound clock instant).
type AtRiskDetector struct {
	clk clock.Clock
}

// NewAtRiskDetector constructs a detector bound to a clock (RealClock in prod, a
// fixed MockClock in tests).
func NewAtRiskDetector(clk clock.Clock) *AtRiskDetector {
	if clk == nil {
		clk = clock.RealClock{}
	}
	return &AtRiskDetector{clk: clk}
}

// Classify evaluates the three signals and the Good/Normal split (D4). Any tripped
// signal → at_risk with the reason slug(s); insufficient data never trips.
func (d *AtRiskDetector) Classify(in AtRiskInputs) AtRiskResult {
	reasons := make([]string, 0, 3)

	// Signal 1 — attendance floor. Not evaluable when nothing is marked.
	if in.AttendanceTotalMarked > 0 {
		ratio := float64(in.AttendancePresentLate) / float64(in.AttendanceTotalMarked)
		if ratio < AtRiskAttendanceFloor {
			reasons = append(reasons, AtRiskReasonAttendance)
		}
	}

	// Signal 2 — consecutive missed (leading run).
	if in.ConsecutiveMissed >= AtRiskConsecutiveMissed {
		reasons = append(reasons, AtRiskReasonConsecutive)
	}

	// Signal 3 — band drop over the last AtRiskGradedWindow released grades.
	if len(in.RecentReleasedBands) >= AtRiskGradedWindow {
		window := in.RecentReleasedBands[len(in.RecentReleasedBands)-AtRiskGradedWindow:]
		if window[0]-window[len(window)-1] >= AtRiskBandDropDelta {
			reasons = append(reasons, AtRiskReasonBandDrop)
		}
	}

	if len(reasons) > 0 {
		return AtRiskResult{Status: AtRiskStatusAtRisk, Reasons: reasons}
	}

	// No signal tripped — good iff on track against the class target, else normal.
	if in.OverallBand != nil && in.ClassTargetBand != nil && *in.OverallBand >= *in.ClassTargetBand {
		return AtRiskResult{Status: AtRiskStatusGood, Reasons: []string{}}
	}
	return AtRiskResult{Status: AtRiskStatusNormal, Reasons: []string{}}
}
