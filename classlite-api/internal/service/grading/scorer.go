// Package grading owns the Writing grading domain (Story 6.1): the IELTS overall
// band scorer and the GradingService (grade write/release/revise, teacher reads,
// grading queue). The overall band is server-authoritative — the client never
// sends it (AC7).
package grading

import (
	"fmt"
	"math"
)

// The four IELTS Writing criterion keys (camelCase — mirror the criterion_scores
// JSONB + the api.yaml CriterionScores schema). CQ-3: named, not inlined.
const (
	CriterionTaskResponse      = "taskResponse"
	CriterionCoherenceCohesion = "coherenceCohesion"
	CriterionLexicalResource   = "lexicalResource"
	CriterionGrammaticalRange  = "grammaticalRange"
)

// MinBand / MaxBand / bandStep bound the valid criterion inputs (AC5): 1.0–9.0 on
// a 0.5 grid.
const (
	MinBand  = 1.0
	MaxBand  = 9.0
	bandStep = 0.5
)

// CriterionScores holds the four IELTS Writing criterion bands. Each is a half-band
// in [1.0, 9.0]; validate with ValidateCriterionScores before scoring.
type CriterionScores struct {
	TaskResponse      float64
	CoherenceCohesion float64
	LexicalResource   float64
	GrammaticalRange  float64
}

func (c CriterionScores) all() [4]float64 {
	return [4]float64{c.TaskResponse, c.CoherenceCohesion, c.LexicalResource, c.GrammaticalRange}
}

// Band is an IELTS band expressed in HALF-STEPS (band × 2, an integer) so it is
// stored/compared without float error. 13 == 6.5, 12 == 6.0.
type Band struct {
	HalfSteps int
}

// Decimal renders the band as a numeric(2,1) literal ("6.5", "7.0") — the exact
// string handed to pgtype.Numeric.Scan for the overall_band column.
func (b Band) Decimal() string {
	whole := b.HalfSteps / 2
	if b.HalfSteps%2 == 0 {
		return fmt.Sprintf("%d.0", whole)
	}
	return fmt.Sprintf("%d.5", whole)
}

// Float returns the band as a float64 (JSON wire value). Exact: HalfSteps/2 has a
// power-of-two denominator.
func (b Band) Float() float64 {
	return float64(b.HalfSteps) / 2.0
}

// OverallBand computes the IELTS overall Writing band from the four criteria
// (AC7), ENTIRELY in integer eighth-band space so no float rounding can flip
// 6.0↔6.5. Four half-band inputs average to eighth granularity; the rounding rule
// is nearest-half with two IELTS special-cases (.25 → .5 rounds UP, .75 → next
// whole rounds UP):
//
//	.0 / .125 → .0        (frac 0,1)
//	.25 / .375 / .5 / .625 → .5   (frac 2,3,4,5)
//	.75 / .875 → next whole       (frac 6,7)
//
// Precondition: cs passed ValidateCriterionScores (each a half-band). Each
// band × 8 is an exact multiple of 4, so the sum is a multiple of 4 and the mean
// in eighths (sum/4) is an exact integer — the division never truncates real data.
func OverallBand(cs CriterionScores) Band {
	return OverallBandFromFour(cs.all())
}

// OverallBandFromFour is the skill-agnostic core of OverallBand (story 6.3a — D1). It
// scores any four half-band criteria (Writing OR Speaking) with the identical IELTS
// half-rounding rule, entirely in integer eighth-band space. OverallBand delegates
// here so the two never diverge; the Speaking grade path calls it directly (packing
// speaking bands into the writing struct — reuse-by-abuse — is REJECTED, D1).
//
// Precondition: each element passed Validate{,Speaking}CriterionScores (a half-band).
func OverallBandFromFour(bands [4]float64) Band {
	sumEighths := 0
	for _, band := range bands {
		sumEighths += int(math.Round(band * 8))
	}
	meanEighths := sumEighths / 4 // exact: sumEighths is a multiple of 4
	whole := meanEighths / 8
	frac := meanEighths % 8

	var halfAdd int
	switch {
	case frac <= 1: // .0, .125
		halfAdd = 0
	case frac <= 5: // .25, .375, .5, .625
		halfAdd = 1
	default: // .75, .875
		halfAdd = 2
	}
	return Band{HalfSteps: whole*2 + halfAdd}
}
