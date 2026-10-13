// Story 11-0b — report renderer coverage (AC6): the structured report builds + renders
// deterministically with no Gemini/DB, computes the DONE gate, and surfaces per-band-bucket
// MAE + over-score direction + stability. UNTAGGED, CI-green.
package calibration

import (
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/service/grading"
)

func sampleReportAt(sampleID string, examinerBand float64, aiCriteria, examinerCriteria map[string]float64, aiOverall float64) SampleReport {
	return SampleReport{
		Accuracy:     BandAccuracy(sampleID, aiCriteria, examinerCriteria, aiOverall, examinerBand, PerCriterionTol, OverallBandTol),
		Coverage:     nil,
		Safety:       FeedbackSafety([]string{"clear feedback"}, nil),
		Source:       "center",
		ExaminerBand: examinerBand,
	}
}

func TestReport_MarkdownAndDoneGate(t *testing.T) {
	examiner := map[string]float64{
		grading.CriterionTaskResponse:      7.0,
		grading.CriterionCoherenceCohesion: 7.0,
		grading.CriterionLexicalResource:   7.0,
		grading.CriterionGrammaticalRange:  6.5,
	}
	// A within-tolerance sample.
	good := sampleReportAt("anchor-01", 7.0, examiner, examiner, 7.0)

	report := Report{
		Date:            "2026-10-12",
		Model:           "gemini-2.0-flash",
		UsingRealData:   false,
		TemperatureNote: "The shipped worker sends no temperature; Gemini's model default governs variance.",
		Samples:         []SampleReport{good},
	}
	md := report.Markdown()
	for _, want := range []string{
		"# AI Grading Calibration Report — 2026-10-12",
		"Synthetic anchors only",         // mechanism-run warning present
		"MAE per examiner band bucket",   // per-bucket section
		"Per-criterion detail",           // per-criterion table
		"gemini-2.0-flash",               // model recorded
		"model default governs variance", // temperature note
	} {
		if !strings.Contains(md, want) {
			t.Errorf("report markdown missing %q", want)
		}
	}
	if !report.Pass() {
		t.Errorf("a within-tolerance, covered, safe, stable-absent sample set must pass the quality gate")
	}
}

func TestReport_FailsWhenMAEOverFloorOrSafetyBreached(t *testing.T) {
	examiner := map[string]float64{
		grading.CriterionTaskResponse:      7.0,
		grading.CriterionCoherenceCohesion: 7.0,
		grading.CriterionLexicalResource:   7.0,
		grading.CriterionGrammaticalRange:  7.0,
	}
	// Push every criterion 1.5 off → per-criterion gate fails AND MAE 1.5 > floor.
	aiFar := map[string]float64{
		grading.CriterionTaskResponse:      8.5,
		grading.CriterionCoherenceCohesion: 8.5,
		grading.CriterionLexicalResource:   8.5,
		grading.CriterionGrammaticalRange:  8.5,
	}
	bad := sampleReportAt("way-off", 7.0, aiFar, examiner, 8.5)
	if bad.Accuracy.Pass {
		t.Fatalf("a 1.5-off sample must fail the per-criterion accuracy gate")
	}
	report := Report{Date: "2026-10-12", Model: "m", Samples: []SampleReport{bad}}
	if report.Pass() {
		t.Errorf("a set whose MAE exceeds the absolute floor must not pass the done gate")
	}
	if report.OverScoreRate() != 1.0 {
		t.Errorf("all samples over-scored → OverScoreRate must be 1.0, got %.2f", report.OverScoreRate())
	}
	if report.SetLevelMAE() <= MaxAcceptableMAE {
		t.Errorf("set-level MAE must exceed the floor for this fixture, got %.3f", report.SetLevelMAE())
	}

	// Safety-breach branch (the "OrSafetyBreached" half of the name): an ACCURATE, covered
	// sample whose feedback leaks a URL must fail the done gate via the safety gate — not via
	// the MAE floor (its MAE is 0).
	safeAcc := BandAccuracy("url-leak", examiner, examiner, 7.0, 7.0, PerCriterionTol, OverallBandTol)
	breach := SampleReport{
		Accuracy:     safeAcc,
		Coverage:     nil,
		Safety:       FeedbackSafety([]string{"See http://example.com for practice."}, nil),
		Source:       "center",
		ExaminerBand: 7.0,
	}
	if breach.Safety.Pass {
		t.Fatalf("a URL leak must breach the safety gate")
	}
	if !safeAcc.Pass || safeAcc.MAE > MaxAcceptableMAE {
		t.Fatalf("the safety-breach fixture must be accurate so the FAIL is attributable to safety, got %+v", safeAcc)
	}
	if (Report{Date: "2026-10-12", Model: "m", Samples: []SampleReport{breach}}).Pass() {
		t.Errorf("an accurate but safety-breaching sample must still fail the done gate")
	}
}

func TestReport_TerminalGradeFailuresFailTheGate(t *testing.T) {
	// P1/DD10: a terminal grade failure (an unparseable/invalid grade) is a QUALITY red, not a
	// transport skip. Even with an otherwise-clean sample present, GradeFailures must fail the
	// done gate; transport failures must NOT.
	examiner := map[string]float64{
		grading.CriterionTaskResponse:      7.0,
		grading.CriterionCoherenceCohesion: 7.0,
		grading.CriterionLexicalResource:   7.0,
		grading.CriterionGrammaticalRange:  6.5,
	}
	clean := sampleReportAt("clean", 7.0, examiner, examiner, 7.0)

	withGradeFail := Report{Date: "2026-10-12", Model: "m", Samples: []SampleReport{clean}, GradeFailures: []string{"sample x: terminal grade failure"}}
	if withGradeFail.Pass() {
		t.Errorf("a terminal grade failure is a quality red (DD10) and must fail the done gate")
	}
	withTransportFail := Report{Date: "2026-10-12", Model: "m", Samples: []SampleReport{clean}, TransportFailures: []string{"sample y: 429"}}
	if !withTransportFail.Pass() {
		t.Errorf("a transport failure is NOT a quality red (DD10) and must not fail the done gate")
	}
}

func TestReport_EmptyNeverPasses(t *testing.T) {
	if (Report{Date: "2026-10-12"}).Pass() {
		t.Errorf("an empty run must never pass the done gate")
	}
}
