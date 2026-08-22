// Story 6.3a (AC4/AC5/AC7 · D1/D3/D4). Pure-function unit contract for
// the SPEAKING grading domain twin. White-box (package grading) so it mirrors the
// shipped scorer_test.go / validation_test.go exactly.
//
// Build-tagged `atdd_red_phase`: excluded from `go test ./...`; run with
//   go test -tags=atdd_red_phase ./internal/service/grading/...
// It FAILS TO COMPILE today because none of the seams below exist yet. Dev removes
// the tag from this file once the twin lands green (5.5a convention).
//
// SEAMS (dev, green phase — the ONE place to reconcile):
//   - grading.SpeakingCriterionScores struct {FluencyCoherence, LexicalResource,
//       GrammaticalRange, Pronunciation float64}  (D3 — a TWIN of CriterionScores,
//       NOT a parameterization; the writing struct's four NAMED fields aren't
//       parameterizable — story D3)
//   - grading.ValidateSpeakingCriterionScores(SpeakingCriterionScores) error
//       (rejects off-grid / out-of-[1,9] the same way ValidateCriterionScores does)
//   - grading.OverallBandFromFour([4]float64) Band   (D1 — the core EXTRACTED from
//       OverallBand; OverallBand keeps its writing-typed signature and delegates to
//       this. Reuse-by-abuse — packing speaking bands into writing-named fields — is
//       REJECTED, story D1.)
//   - grading.TimestampedComment struct {Type, Criterion string; TimestampMs *int; Text string}
//   - grading.NormalizeTimestampComments(in []TimestampedComment, durationMs int) ([]TimestampedComment, error)
//       · demote-NOT-drop: an out-of-range TimestampMs becomes nil (general), the
//         comment is KEPT (D4)
//       · lenient bound = max(durationMs, maxPinMs) + 1000ms slack — a plausible pin
//         PAST a rounded-down persisted duration is KEPT, never demoted (D4 — the
//         FE-decoded-vs-BE-persisted divergence Murat flagged)
//       · degenerate durationMs (≤0) falls back to maxPinMs so pins are kept, not
//         all-demoted
//   - grading.SpeakingDurationMsFromContent(content []byte) int   (parses
//       content.durationSec → ms; absent/0/neg → 0; fractional seconds ROUND, never
//       truncate-to-error — story D4)
//
// Criterion key constants expected (mirror scorer.go:14-19):
//   grading.CriterionFluencyCoherence  = "fluencyCoherence"
//   grading.CriterionLexicalResource   = "lexicalResource"   (shared spelling w/ writing)
//   grading.CriterionGrammaticalRange  = "grammaticalRange"  (shared spelling w/ writing)
//   grading.CriterionPronunciation     = "pronunciation"
package grading

import "testing"

func ptrInt(v int) *int { return &v }

// -----------------------------------------------------------------------------
// AC5 / D3 — ValidateSpeakingCriterionScores: 0.5-grid, [1.0,9.0], twin semantics.
// -----------------------------------------------------------------------------

func TestValidateSpeakingCriterionScores_ATDD(t *testing.T) {
	cases := []struct {
		name    string
		scores  SpeakingCriterionScores
		wantErr bool
	}{
		{"all valid 6.0", SpeakingCriterionScores{6, 6, 6, 6}, false},
		{"valid half-grid mix", SpeakingCriterionScores{6.5, 7, 5.5, 8}, false},
		{"boundary min 1.0", SpeakingCriterionScores{1, 1, 1, 1}, false},
		{"boundary max 9.0", SpeakingCriterionScores{9, 9, 9, 9}, false},
		{"off-grid .25 rejected", SpeakingCriterionScores{6.25, 6, 6, 6}, true},
		{"below min rejected", SpeakingCriterionScores{0.5, 6, 6, 6}, true},
		{"above max rejected", SpeakingCriterionScores{9.5, 6, 6, 6}, true},
		{"off-grid on pronunciation rejected", SpeakingCriterionScores{6, 6, 6, 7.1}, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := ValidateSpeakingCriterionScores(tc.scores)
			if tc.wantErr && err == nil {
				t.Fatalf("expected validation error for %+v, got nil", tc.scores)
			}
			if !tc.wantErr && err != nil {
				t.Fatalf("expected no error for %+v, got %v", tc.scores, err)
			}
		})
	}
}

// -----------------------------------------------------------------------------
// AC4/AC5 / D1 — OverallBandFromFour: byte-identical rounding to the writing scorer.
// The SAME eight-fraction table asserted in scorer_test.go — the extracted core must
// not drift from OverallBand (client twin computeSpeakingOverallBand mirrors this).
// -----------------------------------------------------------------------------

func TestOverallBandFromFour_ATDD(t *testing.T) {
	cases := []struct {
		name     string
		in       [4]float64
		wantHalf int
		wantDec  string
	}{
		{"frac0_exact_6.0", [4]float64{6, 6, 6, 6}, 12, "6.0"},
		{"frac1_6.125_rounds_down", [4]float64{6, 6, 6, 6.5}, 12, "6.0"},
		{"frac2_6.25_rounds_up_to_half", [4]float64{6, 6, 6.5, 6.5}, 13, "6.5"},
		{"frac3_6.375_to_half", [4]float64{6, 6.5, 6.5, 6.5}, 13, "6.5"},
		{"frac4_exact_6.5", [4]float64{6.5, 6.5, 6.5, 6.5}, 13, "6.5"},
		{"frac5_6.625_to_half", [4]float64{6.5, 6.5, 6.5, 7}, 13, "6.5"},
		{"frac6_6.75_next_whole", [4]float64{6.5, 6.5, 7, 7}, 14, "7.0"},
		{"frac7_6.875_next_whole", [4]float64{6.5, 7, 7, 7}, 14, "7.0"},
		{"all_min_1.0", [4]float64{1, 1, 1, 1}, 2, "1.0"},
		{"all_max_9.0", [4]float64{9, 9, 9, 9}, 18, "9.0"},
		{"7.75_next_whole", [4]float64{7.5, 7.5, 8, 8}, 16, "8.0"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := OverallBandFromFour(tc.in)
			if got.HalfSteps != tc.wantHalf {
				t.Errorf("HalfSteps = %d, want %d", got.HalfSteps, tc.wantHalf)
			}
			if got.Decimal() != tc.wantDec {
				t.Errorf("Decimal = %q, want %q", got.Decimal(), tc.wantDec)
			}
		})
	}
}

// OverallBand (writing) MUST delegate to the extracted core so the two never diverge.
func TestOverallBand_DelegatesToFourCore_ATDD(t *testing.T) {
	cs := CriterionScores{6.5, 6.5, 7, 7}
	viaStruct := OverallBand(cs)
	viaCore := OverallBandFromFour([4]float64{6.5, 6.5, 7, 7})
	if viaStruct.HalfSteps != viaCore.HalfSteps {
		t.Fatalf("OverallBand=%d must equal OverallBandFromFour=%d (D1 extraction)", viaStruct.HalfSteps, viaCore.HalfSteps)
	}
}

// -----------------------------------------------------------------------------
// AC7 / D4 — NormalizeTimestampComments: demote-not-drop, LENIENT bound.
// The headline D4 assertion: a pin at 59_000ms with a persisted duration of
// 58_000ms is KEPT (not demoted) — the FE composed it against the decoded buffer,
// the BE only knows the rounded persist. Absurd/negative pins demote to general.
// -----------------------------------------------------------------------------

func TestNormalizeTimestampComments_LenientBound_ATDD(t *testing.T) {
	const persisted = 58_000 // ms — a rounded-DOWN persist (5.4 stores an estimate)

	in := []TimestampedComment{
		{Type: "praise", Criterion: CriterionFluencyCoherence, TimestampMs: ptrInt(12_000), Text: "clear opening"},
		// Plausible pin PAST the rounded persist — MUST be kept (D4 divergence fix).
		{Type: "error", Criterion: CriterionPronunciation, TimestampMs: ptrInt(59_000), Text: "th→f slip"},
		// Negative → demote to general, KEEP the comment.
		{Type: "suggestion", Criterion: CriterionLexicalResource, TimestampMs: ptrInt(-1), Text: "vary linkers"},
		// Absurdly out of range (> max(persisted,maxPin)+1s) → demote to general, KEEP.
		{Type: "error", Criterion: CriterionGrammaticalRange, TimestampMs: ptrInt(9_999_999), Text: "tense"},
		// Already general (nil) → stays general.
		{Type: "praise", Criterion: CriterionFluencyCoherence, TimestampMs: nil, Text: "overall fluent"},
	}

	got, err := NormalizeTimestampComments(in, persisted)
	if err != nil {
		t.Fatalf("valid taxonomy must not error: %v", err)
	}

	if len(got) != len(in) {
		t.Fatalf("demote-not-drop violated: got %d comments, want %d (none may be dropped)", len(got), len(in))
	}
	// [0] in-range pin unchanged.
	if got[0].TimestampMs == nil || *got[0].TimestampMs != 12_000 {
		t.Errorf("in-range pin was altered: %v", got[0].TimestampMs)
	}
	// [1] plausible-past-persisted pin KEPT (the whole point of D4).
	if got[1].TimestampMs == nil || *got[1].TimestampMs != 59_000 {
		t.Errorf("plausible pin past rounded persist (59s vs 58s) was demoted — D4 lenient bound violated")
	}
	// [2] negative demoted to general, text preserved.
	if got[2].TimestampMs != nil {
		t.Errorf("negative pin must demote to general, got %v", *got[2].TimestampMs)
	}
	if got[2].Text != "vary linkers" {
		t.Errorf("demotion must preserve the comment text, got %q", got[2].Text)
	}
	// [3] absurd demoted to general.
	if got[3].TimestampMs != nil {
		t.Errorf("absurd out-of-range pin must demote to general, got %v", *got[3].TimestampMs)
	}
	// [4] already-general stays general.
	if got[4].TimestampMs != nil {
		t.Errorf("nil pin must stay general, got %v", *got[4].TimestampMs)
	}
}

// Degenerate persisted duration (absent/0/negative) must NOT all-demote — fall back
// to maxPinMs so a real pin is kept (D4).
func TestNormalizeTimestampComments_DegenerateDuration_KeepsPins_ATDD(t *testing.T) {
	in := []TimestampedComment{
		{Type: "error", Criterion: CriterionPronunciation, TimestampMs: ptrInt(30_000), Text: "vowel"},
		{Type: "praise", Criterion: CriterionFluencyCoherence, TimestampMs: ptrInt(45_000), Text: "pace"},
	}
	for _, dur := range []int{0, -1} {
		got, err := NormalizeTimestampComments(in, dur)
		if err != nil {
			t.Fatalf("valid taxonomy must not error: %v", err)
		}
		if got[0].TimestampMs == nil || got[1].TimestampMs == nil {
			t.Errorf("degenerate durationMs=%d demoted a valid pin — must fall back to maxPinMs (D4)", dur)
		}
	}
}

// -----------------------------------------------------------------------------
// AC7 / D4 — SpeakingDurationMsFromContent: absent/0/neg → 0; fractional ROUNDS.
// -----------------------------------------------------------------------------

func TestSpeakingDurationMsFromContent_ATDD(t *testing.T) {
	cases := []struct {
		name    string
		content string
		wantMs  int
	}{
		{"whole seconds", `{"audioKey":"k","durationSec":58}`, 58_000},
		{"fractional rounds not truncates", `{"audioKey":"k","durationSec":58.6}`, 58_600},
		{"absent → 0", `{"audioKey":"k"}`, 0},
		{"zero → 0", `{"audioKey":"k","durationSec":0}`, 0},
		{"negative → 0", `{"audioKey":"k","durationSec":-3}`, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := SpeakingDurationMsFromContent([]byte(tc.content))
			if got != tc.wantMs {
				t.Errorf("SpeakingDurationMsFromContent(%s) = %d, want %d", tc.content, got, tc.wantMs)
			}
		})
	}
}
