//go:build calibration

// Story 11-0b — the REAL-DATA calibration run (AC1–AC4, AC6). It is EXCLUDED from the
// default suite by the `calibration` build tag and LOUD-SKIPs unless BOTH a real
// gemini.Client key (GEMINI_API_KEY) and a real gold-set dir (CALIBRATION_DATASET_DIR) are
// present — so CI stays green and spends no credits (mirrors internal/media's ffmpeg
// LOUD-SKIP). Run it manually:
//
//	GEMINI_API_KEY=… CALIBRATION_DATASET_DIR=/path/to/goldset \
//	  go test -tags=calibration ./internal/calibration/ -run Calibration -v
//
// DD1: it drives the SHIPPED GradeWritingHandler through the DD3 read-only accessor with
// the REAL gemini.Client — it never reimplements the prompt/parse/scorer. DD10: a Gemini
// 429/network/timeout is classified as a TRANSPORT failure (retried, then skipped),
// NEVER reported as a quality red; the grader is non-deterministic, so stability is
// measured over StabilityReGrades draws and the whole run is recorded as evidence (the
// numbers are not a CI gate — DD7). The import of internal/test{,/workers} + internal/worker
// lives ONLY in this tagged file (Winston — the pure package files stay test-free).
package calibration

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/google/uuid"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
	testpkg "github.com/ducdo/classlite-api/internal/test"
	"github.com/ducdo/classlite-api/internal/test/workers"
	"github.com/ducdo/classlite-api/internal/worker"
)

const (
	geminiAPIKeyEnv      = "GEMINI_API_KEY"
	defaultGeminiModel   = "gemini-2.0-flash"
	transportMaxAttempts = 3
	transportBackoff     = 2 * time.Second
	// defaultReportDir is the evidence location relative to this package dir
	// (classlite-api/internal/calibration → repo root is three levels up). Override with
	// CALIBRATION_REPORT_DIR.
	defaultReportDir = "../../../_bmad-output/test-artifacts/calibration"
	reportDirEnv     = "CALIBRATION_REPORT_DIR"
	runDateEnv       = "CALIBRATION_RUN_DATE"
	// temperatureNote records the Task-4b / AC2 finding: the shipped writing worker sends
	// NO temperature (gemini.GenerateRequest carries none; geminiGenerationConfig sends
	// only responseMimeType + maxOutputTokens), so Gemini's model default (≈1.0 for
	// gemini-2.0-flash) governs run-to-run variance — stability is partly a sampler
	// property. If AC2 fails, pinning temperature in the worker's GenerateRequest is the
	// candidate fix (a grading-behaviour change → a separate story, out of 11-0b scope).
	temperatureNote = "AC2/Task-4b: the shipped writing worker sends NO temperature to Gemini " +
		"(gemini.GenerateRequest has no temperature field; the request config sends only " +
		"responseMimeType + maxOutputTokens), so the model default (≈1.0 for gemini-2.0-flash) " +
		"governs run-to-run variance. Stability is therefore partly a sampler property; if it " +
		"fails, pinning temperature in the worker is the candidate fix (a separate story)."
)

// TestCalibration_WritingRealData is the authoritative gated run (DD7 — the DONE gate
// matures through the L1 pilot on the bands-4-6 cohort). It grades every writing gold
// sample through the real grader, runs the four machine assertions, measures stability on
// the first graded sample, and writes a report. It never asserts a hard FAIL on the
// quality numbers (DD7 — the numbers are recorded evidence, not a CI gate); it DOES fail
// on infrastructure problems (hash mismatch, zero gradeable samples) and on a dataset that
// is entirely transport-failed.
func TestCalibration_WritingRealData(t *testing.T) {
	apiKey := os.Getenv(geminiAPIKeyEnv)
	datasetDir := os.Getenv(DatasetDirEnv)
	if apiKey == "" || datasetDir == "" {
		t.Skipf("LOUD-SKIP calibration run: need both %s and %s set (apiKeySet=%t, datasetDirSet=%t). "+
			"CI stays green + spends no credits; see docs/manual-setup.md.",
			geminiAPIKeyEnv, DatasetDirEnv, apiKey != "", datasetDir != "")
	}

	set, err := LoadGoldSet() // hash-verifies every sample at start (AC6) — hard error on mismatch
	if err != nil {
		t.Fatalf("gold set load/verify failed: %v", err)
	}
	writing := set.Writing()
	if len(writing) == 0 {
		t.Fatalf("gold set has no writing samples (speaking dataset is deferred — DD4)")
	}

	modelName := geminiModel()
	client := gemini.NewClient(apiKey, modelName)

	h := workers.SetupWorkerHarness(t)
	center := testpkg.CreateCenterWithID(t, h.DB, testpkg.TenantAID, "Calibration Center", "CALIB")
	tenantUUID := uuid.MustParse(testpkg.TenantAID)

	report := Report{
		Date:            runDate(),
		Model:           modelName,
		UsingRealData:   set.UsingRealData,
		TemperatureNote: temperatureNote,
	}

	for _, sample := range writing {
		ctx := testpkg.TenantContext(t, h.DB, center.ID)
		subID := testpkg.SeedWritingSubmissionWithContent(t, h.DB, tenantUUID, string(sample.Content))
		handler := worker.NewGradeWritingHandler(h.DB, client, h.Clock)
		payload := writingPayload(t, subID)
		tc := model.TenantContext{CenterID: testpkg.TenantAID}

		res, gradeErr := gradeWritingWithRetry(ctx, t, handler, tc, payload)
		if gradeErr != nil {
			// DD10: classify. A retried-and-exhausted TRANSPORT error (429/network) is NOT a
			// quality red; a terminal grade failure (ErrInvalidAIResponse — unparseable/invalid
			// grade) IS. The retry helper returns errors distinguishable by errors.Is; the
			// caller must not lump them, or a systematic grade regression reads as "infra".
			if errors.Is(gradeErr, worker.ErrTransientGeneration) {
				report.TransportFailures = append(report.TransportFailures,
					fmt.Sprintf("sample %s: %v", sample.ID, gradeErr))
				t.Logf("TRANSPORT failure on %s (NOT a quality red, DD10): %v", sample.ID, gradeErr)
			} else {
				report.GradeFailures = append(report.GradeFailures,
					fmt.Sprintf("sample %s: %v", sample.ID, gradeErr))
				t.Logf("QUALITY RED on %s — terminal grade failure (DD10): %v", sample.ID, gradeErr)
			}
			continue
		}

		report.Samples = append(report.Samples, SampleReport{
			Accuracy:     BandAccuracy(sample.ID, WritingCriteriaMap(res), sample.ExaminerCriteria, WritingOverall(res), sample.ExaminerOverall, PerCriterionTol, OverallBandTol),
			Coverage:     CriterionCoverage(grading.SkillWriting, res, sample.Language),
			Safety:       FeedbackSafety(WritingFeedbackTexts(res), sample.PIIProbes),
			Source:       sample.Source,
			ExaminerBand: sample.ExaminerOverall,
		})

		// Stability is measured once, on the first sample that graded cleanly (DD5 — 5
		// regrades, per-criterion range AND overall stddev).
		if report.Stability == nil {
			report.Stability = measureWritingStability(ctx, t, handler, tc, payload, sample.ID)
		}
	}

	if len(report.Samples) == 0 {
		if len(report.GradeFailures) > 0 {
			// Every sample that ran produced a terminal GRADE failure — those are quality reds
			// (DD10), not infrastructure. Fall through to write the report so Pass()=false
			// records the regression; do NOT Fatalf this as an infra problem.
			t.Logf("no samples graded cleanly: %d terminal grade failure(s) — quality reds (DD10), writing report with a FAIL verdict", len(report.GradeFailures))
		} else {
			t.Fatalf("no writing samples graded cleanly — every sample was a transport failure (%d). "+
				"This is an infrastructure problem, not a grading verdict (DD10).", len(report.TransportFailures))
		}
	}

	md := report.Markdown()
	path, err := WriteReport(reportDir(), report.Date, md)
	if err != nil {
		t.Fatalf("write calibration report: %v", err)
	}
	t.Logf("calibration report written: %s", path)

	// AC1 stratification warning (NOT a fail — dataset size is Ducdo's Phase-2 toil).
	warnStratification(t, report)

	// DD7: the quality numbers are recorded EVIDENCE, not a CI gate. Log the verdict; do
	// not t.Fail on it. The report + examiner-scored run is what Ducdo reads to close to
	// `done`.
	t.Logf("CALIBRATION VERDICT (evidence, not a CI gate — DD7): pass=%t, set-MAE=%.3f (floor %.2f), over-score=%.0f%%",
		report.Pass(), report.SetLevelMAE(), MaxAcceptableMAE, report.OverScoreRate()*100)
}

// gradeWritingWithRetry drives the real grader via the DD3 accessor, retrying a TRANSPORT
// failure (ErrTransientGeneration — 429/network/timeout) up to transportMaxAttempts with
// backoff. A non-transport error (e.g. ErrInvalidAIResponse — a grade that failed the
// shipped validator) is returned as a graded result failure path: it surfaces as a parse
// failure the caller records, NOT a transport skip. Returns (result, transportErr).
func gradeWritingWithRetry(ctx context.Context, t *testing.T, handler *worker.GradeWritingHandler, tc model.TenantContext, payload json.RawMessage) (model.AIWritingGradeResult, error) {
	t.Helper()
	var lastErr error
	for attempt := 1; attempt <= transportMaxAttempts; attempt++ {
		frag, err := handler.GenerateResult(ctx, tc, payload)
		if err == nil {
			var res model.AIWritingGradeResult
			if uerr := json.Unmarshal(frag, &res); uerr != nil {
				return model.AIWritingGradeResult{}, fmt.Errorf("decode fragment: %w", uerr)
			}
			return res, nil
		}
		if errors.Is(err, worker.ErrTransientGeneration) {
			lastErr = err
			// No backoff after the final attempt — there is no retry to wait for.
			if attempt < transportMaxAttempts {
				t.Logf("transport attempt %d/%d failed, backing off: %v", attempt, transportMaxAttempts, err)
				time.Sleep(transportBackoff)
			}
			continue
		}
		// A terminal grade failure (ErrInvalidAIResponse) is NOT a transport problem — it
		// is the grader producing an unparseable/invalid grade, which is a real quality
		// signal. Return it as a transport-style error only after the last attempt would
		// mislead; instead treat it as a hard grade failure surfaced to the caller.
		return model.AIWritingGradeResult{}, fmt.Errorf("terminal grade failure (quality signal, not transport): %w", err)
	}
	return model.AIWritingGradeResult{}, fmt.Errorf("transport failure after %d attempts: %w", transportMaxAttempts, lastErr)
}

// measureWritingStability grades the same submission StabilityReGrades times and computes
// the per-criterion ranges + overall-band stddev (DD5). A transport failure mid-run logs
// and shortens the sample; the Stability function tolerates a short series.
func measureWritingStability(ctx context.Context, t *testing.T, handler *worker.GradeWritingHandler, tc model.TenantContext, payload json.RawMessage, sampleID string) *StabilitySummary {
	t.Helper()
	byCriterion := map[string][]float64{}
	var overall []float64
	for i := 0; i < StabilityReGrades; i++ {
		res, err := gradeWritingWithRetry(ctx, t, handler, tc, payload)
		if err != nil {
			t.Logf("stability regrade %d/%d skipped: %v", i+1, StabilityReGrades, err)
			continue
		}
		for key, band := range WritingCriteriaMap(res) {
			byCriterion[key] = append(byCriterion[key], band)
		}
		overall = append(overall, WritingOverall(res))
	}
	result := Stability(byCriterion, overall, StabilityCriterionRangeTol, StabilityOverallStddevTol)
	return &StabilitySummary{SampleID: sampleID, Result: result}
}

// warnStratification logs (never fails) when a band bucket holds fewer than
// MinStratifiedPerHalfBand samples — the dataset size is Ducdo's Phase-2 assembly toil.
func warnStratification(t *testing.T, report Report) {
	t.Helper()
	counts := map[string]int{}
	for _, s := range report.Samples {
		counts[fmt.Sprintf("%.1f", s.ExaminerBand)]++
	}
	for bucket, n := range counts {
		if n < MinStratifiedPerHalfBand {
			t.Logf("STRATIFICATION WARNING: band bucket %s has %d sample(s) (< MinStratifiedPerHalfBand=%d) — not yet a stratified set (AC1)", bucket, n, MinStratifiedPerHalfBand)
		}
	}
}

func writingPayload(t *testing.T, subID uuid.UUID) json.RawMessage {
	t.Helper()
	raw, err := json.Marshal(model.AIGradeWritingParams{SubmissionID: subID.String()})
	if err != nil {
		t.Fatalf("marshal writing payload: %v", err)
	}
	return raw
}

func geminiModel() string {
	if m := os.Getenv("GEMINI_MODEL"); m != "" {
		return m
	}
	return defaultGeminiModel
}

func reportDir() string {
	if d := os.Getenv(reportDirEnv); d != "" {
		return d
	}
	return filepath.Clean(defaultReportDir)
}

// runDate returns the report date, preferring CALIBRATION_RUN_DATE (so the report path is
// reproducible) and falling back to today. report.go itself never calls time.Now() — the
// date is always passed in (determinism); this tagged driver is the only clock reader.
func runDate() string {
	if d := os.Getenv(runDateEnv); d != "" {
		return d
	}
	return time.Now().Format("2006-01-02")
}
