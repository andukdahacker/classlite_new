// Story 11-0b — the calibration report. Report rendering is a PLAIN exported function
// returning a structured report + a Markdown renderer (Winston — so a future
// tools/calibrate binary is a trivial main calling this package; the logic is NOT buried
// in a test body). <date> is passed in, never time.Now(), so the output is deterministic.
//
// The report carries per-criterion AND overall band deltas, MAE per band bucket (not just
// set-wide — a set-wide number is dominated by wherever the anchors cluster), the worst
// single-criterion miss, the over-score direction/rate, stability spreads/stddev, and
// pass/fail.
package calibration

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// SampleReport is one sample's full calibration outcome: accuracy, coverage (nil = pass),
// and feedback safety, plus the source + examiner band for bucketing/reporting.
type SampleReport struct {
	Accuracy     SampleAccuracy
	Coverage     error // nil = coverage passed
	Safety       SafetyResult
	Source       string // cambridge | idp | center
	ExaminerBand float64
}

// StabilitySummary pairs the re-grade stability result with the sample it was run on.
type StabilitySummary struct {
	SampleID string
	Result   StabilityResult
}

// Report is the structured calibration report for one run.
type Report struct {
	Date              string
	Model             string
	UsingRealData     bool
	TemperatureNote   string
	Samples           []SampleReport
	Stability         *StabilitySummary
	TransportFailures []string // 429/network/timeout — NOT a quality red (DD10)
	GradeFailures     []string // terminal invalid/unparseable grades — these ARE quality reds (DD10)
}

// SetLevelMAE is the mean per-criterion MAE across all samples (the absolute floor is
// MaxAcceptableMAE — the DONE gate, not a self-baseline).
func (r Report) SetLevelMAE() float64 {
	if len(r.Samples) == 0 {
		return 0
	}
	var sum float64
	for _, s := range r.Samples {
		sum += s.Accuracy.MAE
	}
	return sum / float64(len(r.Samples))
}

// MAEPerBandBucket groups samples by examiner overall half-band and returns each bucket's
// mean per-criterion MAE, so a set-wide number that hides a weak band bucket is visible.
func (r Report) MAEPerBandBucket() map[string]float64 {
	sums := map[string]float64{}
	counts := map[string]int{}
	for _, s := range r.Samples {
		key := bucketKey(s.ExaminerBand)
		sums[key] += s.Accuracy.MAE
		counts[key]++
	}
	out := map[string]float64{}
	for key, sum := range sums {
		out[key] = sum / float64(counts[key])
	}
	return out
}

// OverScoreRate is the fraction of samples whose AI overall exceeded the examiner's — the
// commercially lethal direction (Mary).
func (r Report) OverScoreRate() float64 {
	if len(r.Samples) == 0 {
		return 0
	}
	var over int
	for _, s := range r.Samples {
		if s.Accuracy.OverScored {
			over++
		}
	}
	return float64(over) / float64(len(r.Samples))
}

// WorstMiss is the largest single-criterion absolute miss across all samples.
func (r Report) WorstMiss() (string, CriterionDelta) {
	var worst CriterionDelta
	var sampleID string
	for _, s := range r.Samples {
		if s.Accuracy.WorstMiss.AbsDelta > worst.AbsDelta {
			worst = s.Accuracy.WorstMiss
			sampleID = s.Accuracy.SampleID
		}
	}
	return sampleID, worst
}

// Pass is the DONE quality gate for this run: every sample within the per-criterion
// accuracy gate, coverage clean, feedback safe, the set-level MAE under the ABSOLUTE floor
// (MaxAcceptableMAE — not a self-baseline), and stability passing when measured. An empty
// run never passes. Transport failures do NOT affect Pass (DD10 — a 429 is not a quality
// red); they are surfaced separately. Terminal GRADE failures (an unparseable/invalid grade)
// ARE quality reds and fail the gate (DD10 — transport failure ≠ grade-wrong).
func (r Report) Pass() bool {
	if len(r.Samples) == 0 {
		return false
	}
	if len(r.GradeFailures) > 0 {
		return false
	}
	for _, s := range r.Samples {
		if !s.Accuracy.Pass || s.Coverage != nil || !s.Safety.Pass {
			return false
		}
	}
	if r.SetLevelMAE() > MaxAcceptableMAE {
		return false
	}
	if r.Stability != nil && !r.Stability.Result.Pass {
		return false
	}
	return true
}

// Markdown renders the report as a human-readable product-evidence document.
func (r Report) Markdown() string {
	var b strings.Builder
	fmt.Fprintf(&b, "# AI Grading Calibration Report — %s\n\n", r.Date)
	fmt.Fprintf(&b, "_Story 11-0b product evidence. Model: `%s`. Dataset: **%s**._\n\n", r.Model, datasetLabel(r.UsingRealData))
	if !r.UsingRealData {
		b.WriteString("> ⚠️ **Synthetic anchors only** — this is a MECHANISM run, not admissible accuracy evidence. ")
		b.WriteString("The DONE gate (DD7) requires the bands-4-6 center-banded cohort with a real `gemini.Client`.\n\n")
	}
	fmt.Fprintf(&b, "**Overall result: %s**\n\n", passLabel(r.Pass()))

	// Accuracy summary.
	b.WriteString("## Accuracy\n\n")
	fmt.Fprintf(&b, "- Set-level MAE (per-criterion): **%.3f** (absolute floor `MaxAcceptableMAE` = %.2f — the DONE gate, not a self-baseline)\n", r.SetLevelMAE(), MaxAcceptableMAE)
	fmt.Fprintf(&b, "- Over-score rate (AI overall > examiner): **%.0f%%** (over-scoring a weak student is the commercially lethal direction)\n", r.OverScoreRate()*100)
	if sampleID, worst := r.WorstMiss(); worst.AbsDelta > 0 {
		fmt.Fprintf(&b, "- Worst single-criterion miss: **%+.1f** on `%s` (sample `%s`)\n", worst.Delta, worst.Criterion, sampleID)
	}
	b.WriteString("\n### MAE per examiner band bucket\n\n")
	b.WriteString("| Band bucket | Mean per-criterion MAE |\n|---|---|\n")
	bucketMAE := r.MAEPerBandBucket()
	for _, key := range sortedStringKeys(bucketMAE) {
		fmt.Fprintf(&b, "| %s | %.3f |\n", key, bucketMAE[key])
	}
	b.WriteString("\n")

	// Per-sample band-delta table.
	b.WriteString("### Per-sample band deltas (AI − examiner)\n\n")
	b.WriteString("| Sample | Source | Examiner overall | AI overall | Overall Δ | Per-criterion gate | Coverage | Safety |\n")
	b.WriteString("|---|---|---|---|---|---|---|---|\n")
	for _, s := range r.Samples {
		a := s.Accuracy
		fmt.Fprintf(&b, "| `%s` | %s | %.1f | %.1f | %+.1f | %s | %s | %s |\n",
			a.SampleID, s.Source, a.OverallExaminer, a.OverallAI, a.OverallDelta,
			passLabel(a.Pass), coverageLabel(s.Coverage), passLabel(s.Safety.Pass))
	}
	b.WriteString("\n")

	// Detailed per-criterion deltas.
	b.WriteString("### Per-criterion detail\n\n")
	for _, s := range r.Samples {
		fmt.Fprintf(&b, "**`%s`** (examiner overall %.1f):\n\n", s.Accuracy.SampleID, s.Accuracy.OverallExaminer)
		b.WriteString("| Criterion | AI | Examiner | Δ | Within ±1.0 |\n|---|---|---|---|---|\n")
		for _, c := range s.Accuracy.Criteria {
			ai := "—"
			if c.Present {
				ai = fmt.Sprintf("%.1f", c.AI)
			}
			fmt.Fprintf(&b, "| %s | %s | %.1f | %+.1f | %s |\n", c.Criterion, ai, c.Examiner, c.Delta, passLabel(c.Pass))
		}
		if s.Coverage != nil {
			fmt.Fprintf(&b, "\n_Coverage failure: %s_\n", s.Coverage.Error())
		}
		for _, f := range s.Safety.PIIFindings {
			fmt.Fprintf(&b, "\n_🔴 Safety (PII): %s_\n", f)
		}
		for _, f := range s.Safety.URLFindings {
			fmt.Fprintf(&b, "\n_🔴 Safety (URL): %s_\n", f)
		}
		for _, f := range s.Safety.ReviewSamples {
			fmt.Fprintf(&b, "\n_🟡 %s_\n", f)
		}
		b.WriteString("\n")
	}

	// Stability.
	b.WriteString("## Re-grade stability\n\n")
	if r.Stability == nil {
		b.WriteString("_Not measured in this run._\n\n")
	} else {
		st := r.Stability.Result
		fmt.Fprintf(&b, "Sample `%s`, %d re-grades. Gate: per-criterion range ≤ %.1f AND overall stddev ≤ %.2f.\n\n",
			r.Stability.SampleID, st.ReGrades, StabilityCriterionRangeTol, StabilityOverallStddevTol)
		if !st.Measured {
			fmt.Fprintf(&b, "> ⚠️ **Not conclusively measured** — only %d successful re-grade(s) (< %d). The verdict below is a FAIL, not a pass: re-run with working transport to get a real stability measurement.\n\n", st.ReGrades, minStabilityRegradesForVerdict)
		}
		fmt.Fprintf(&b, "- Overall-band stddev: **%.3f** → %s\n", st.OverallStddev, passLabel(st.StddevPass))
		b.WriteString("\n| Criterion | Regrade range | Within ≤1.0 |\n|---|---|---|\n")
		for _, c := range st.Criteria {
			fmt.Fprintf(&b, "| %s | %.1f | %s |\n", c.Criterion, c.Range, passLabel(c.Pass))
		}
		fmt.Fprintf(&b, "\n**Stability result: %s**\n\n", passLabel(st.Pass))
	}
	if r.TemperatureNote != "" {
		fmt.Fprintf(&b, "> %s\n\n", r.TemperatureNote)
	}

	// Grade failures ARE quality reds (terminal invalid/unparseable grades) — DD10.
	if len(r.GradeFailures) > 0 {
		b.WriteString("## 🔴 Grade failures (quality reds — DD10)\n\n")
		b.WriteString("_Terminal invalid/unparseable grades from the shipped grader. These FAIL the done gate — a grade-wrong is not a transport problem._\n\n")
		for _, f := range r.GradeFailures {
			fmt.Fprintf(&b, "- %s\n", f)
		}
		b.WriteString("\n")
	}

	// Transport failures (NOT quality reds).
	if len(r.TransportFailures) > 0 {
		b.WriteString("## Transport failures (NOT quality reds — DD10)\n\n")
		for _, f := range r.TransportFailures {
			fmt.Fprintf(&b, "- %s\n", f)
		}
		b.WriteString("\n")
	}

	return b.String()
}

// WriteReport writes md to <outputDir>/calibration-report-<date>.md, creating outputDir if
// needed, and returns the path. date is caller-supplied (never time.Now()) for determinism.
func WriteReport(outputDir, date, md string) (string, error) {
	if err := os.MkdirAll(outputDir, 0o755); err != nil {
		return "", fmt.Errorf("create calibration report dir %s: %w", outputDir, err)
	}
	path := filepath.Join(outputDir, fmt.Sprintf("calibration-report-%s.md", date))
	if err := os.WriteFile(path, []byte(md), 0o644); err != nil {
		return "", fmt.Errorf("write calibration report %s: %w", path, err)
	}
	return path, nil
}

func bucketKey(band float64) string { return fmt.Sprintf("%.1f", band) }

func datasetLabel(real bool) string {
	if real {
		return "real (CALIBRATION_DATASET_DIR)"
	}
	return "synthetic anchors (testdata/)"
}

func passLabel(pass bool) string {
	if pass {
		return "✅ PASS"
	}
	return "❌ FAIL"
}

func coverageLabel(err error) string {
	if err == nil {
		return "✅ PASS"
	}
	return "❌ FAIL"
}

func sortedStringKeys(m map[string]float64) []string {
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
