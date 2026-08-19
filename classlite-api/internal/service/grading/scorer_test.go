package grading

import "testing"

// TestOverallBand_AllEightFractions walks all eight eighth-band mean fractions
// (AC7). The two IELTS special cases (.25 → .5 up, .75 → next whole up) plus the
// integer-not-float trap (6.125 must NOT round to 6.5) are all exercised.
func TestOverallBand_AllEightFractions(t *testing.T) {
	cases := []struct {
		name     string
		scores   CriterionScores
		wantDec  string
		wantHalf int
	}{
		// frac .0 — exact whole
		{"frac0_exact_6.0", CriterionScores{6.0, 6.0, 6.0, 6.0}, "6.0", 12},
		// frac .125 — the integer-not-float landmine: mean 6.125 rounds DOWN to 6.0
		// (float64 arithmetic would drift it toward 6.5).
		{"frac1_6.125_rounds_down", CriterionScores{6.0, 6.0, 6.0, 6.5}, "6.0", 12},
		// frac .25 — IELTS special case: rounds UP to .5
		{"frac2_6.25_rounds_up_to_half", CriterionScores{6.0, 6.0, 6.5, 6.5}, "6.5", 13},
		// frac .375 — nearest half
		{"frac3_6.375_to_half", CriterionScores{6.0, 6.5, 6.5, 6.5}, "6.5", 13},
		// frac .5 — exact half
		{"frac4_exact_6.5", CriterionScores{6.5, 6.5, 6.5, 6.5}, "6.5", 13},
		// frac .625 — nearest half
		{"frac5_6.625_to_half", CriterionScores{6.5, 6.5, 6.5, 7.0}, "6.5", 13},
		// frac .75 — IELTS special case: rounds UP to next whole
		{"frac6_6.75_next_whole", CriterionScores{6.5, 6.5, 7.0, 7.0}, "7.0", 14},
		// frac .875 — nearest whole
		{"frac7_6.875_next_whole", CriterionScores{6.5, 7.0, 7.0, 7.0}, "7.0", 14},
		// boundary bands
		{"all_min_1.0", CriterionScores{1.0, 1.0, 1.0, 1.0}, "1.0", 2},
		{"all_max_9.0", CriterionScores{9.0, 9.0, 9.0, 9.0}, "9.0", 18},
		// mixed spread landing on 7.75 → next whole (8.0)
		{"7.75_next_whole", CriterionScores{7.5, 7.5, 8.0, 8.0}, "8.0", 16},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := OverallBand(tc.scores)
			if got.HalfSteps != tc.wantHalf {
				t.Errorf("OverallBand(%v).HalfSteps = %d, want %d", tc.scores, got.HalfSteps, tc.wantHalf)
			}
			if got.Decimal() != tc.wantDec {
				t.Errorf("OverallBand(%v).Decimal() = %q, want %q", tc.scores, got.Decimal(), tc.wantDec)
			}
		})
	}
}

func TestValidateCriterionScores(t *testing.T) {
	valid := CriterionScores{6.0, 6.5, 7.0, 5.5}
	if err := ValidateCriterionScores(valid); err != nil {
		t.Fatalf("valid scores rejected: %v", err)
	}

	bad := []struct {
		name   string
		scores CriterionScores
	}{
		{"below_min", CriterionScores{0.5, 6.0, 6.0, 6.0}},
		{"above_max", CriterionScores{9.5, 6.0, 6.0, 6.0}},
		{"off_grid_quarter", CriterionScores{6.25, 6.0, 6.0, 6.0}},
		{"off_grid_tenth", CriterionScores{6.1, 6.0, 6.0, 6.0}},
		{"zero", CriterionScores{0, 6.0, 6.0, 6.0}},
	}
	for _, tc := range bad {
		t.Run(tc.name, func(t *testing.T) {
			if err := ValidateCriterionScores(tc.scores); err == nil {
				t.Errorf("ValidateCriterionScores(%v) = nil, want validation error", tc.scores)
			}
		})
	}
}
