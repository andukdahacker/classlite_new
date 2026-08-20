// Story 6.2a, AC12 S17 — anchor/criterion parity. Pure unit proof (no DB) that an
// AI-produced AIWritingGradeComment is structurally the 6.1 grading.Comment the
// teacher grade-write consumes: the same four criterion keys, lowercase types, and
// UTF-16 anchor offsets that survive (or demote through) the SAME
// grading.NormalizeComments the grade write runs. This is the seam guarantee — a
// suggestion the teacher accepts is gradeable without re-derivation (D10).
package worker_test

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/gemini"
	"github.com/ducdo/classlite-api/internal/model"
	"github.com/ducdo/classlite-api/internal/service/grading"
)

func TestGradeWriting_AnchorCriterionParity(t *testing.T) {
	essay := gemini.WritingGradeFixtureEssay

	// The four AI criterion keys must be EXACTLY the four 6.1 criterion constants —
	// otherwise an accepted suggestion would not map onto the grade form.
	wantKeys := map[string]bool{
		grading.CriterionTaskResponse:      true,
		grading.CriterionCoherenceCohesion: true,
		grading.CriterionLexicalResource:   true,
		grading.CriterionGrammaticalRange:  true,
	}
	if _, ok := wantKeys["grammaticalRange"]; !ok {
		t.Fatal("parity: expected the criterion key to be grammaticalRange (not grammaticalRangeAccuracy)")
	}

	start, end := 0, 3
	aiComment := model.AIWritingGradeComment{
		Type:        grading.CommentTypePraise, // lowercase
		Criterion:   grading.CriterionGrammaticalRange,
		AnchorStart: &start,
		AnchorEnd:   &end,
		Text:        "Strong opening.",
		Confidence:  model.AIConfidenceHigh,
	}

	// Map the AI comment to the 6.1 grade-write shape (dropping confidence, which is
	// never persisted to grades — D3) and run it through the SAME normalizer the grade
	// write uses. A valid anchor must survive unchanged.
	gradeComment := grading.Comment{
		Type:        aiComment.Type,
		Criterion:   aiComment.Criterion,
		AnchorStart: aiComment.AnchorStart,
		AnchorEnd:   aiComment.AnchorEnd,
		Text:        aiComment.Text,
	}
	normalized, err := grading.NormalizeComments([]grading.Comment{gradeComment}, essay)
	if err != nil {
		t.Fatalf("parity: a valid AI comment was rejected by the 6.1 normalizer: %v", err)
	}
	if len(normalized) != 1 {
		t.Fatalf("parity: expected 1 normalized comment, got %d", len(normalized))
	}
	got := normalized[0]
	if got.AnchorStart == nil || got.AnchorEnd == nil || *got.AnchorStart != start || *got.AnchorEnd != end {
		t.Errorf("parity: a valid anchor was not preserved: got %v/%v, want %d/%d",
			got.AnchorStart, got.AnchorEnd, start, end)
	}
	if got.Type != grading.CommentTypePraise || got.Criterion != grading.CriterionGrammaticalRange {
		t.Errorf("parity: type/criterion drifted: %q/%q", got.Type, got.Criterion)
	}

	// An orphan AI anchor demotes to whole-essay through the same normalizer, never
	// dropped (the grade write's contract).
	orphanStart, orphanEnd := len(essay)+5, len(essay)+9
	orphan := grading.Comment{
		Type: grading.CommentTypeError, Criterion: grading.CriterionLexicalResource,
		AnchorStart: &orphanStart, AnchorEnd: &orphanEnd, Text: "out of range",
	}
	demoted, err := grading.NormalizeComments([]grading.Comment{orphan}, essay)
	if err != nil {
		t.Fatalf("parity: orphan normalization errored: %v", err)
	}
	if len(demoted) != 1 || demoted[0].AnchorStart != nil || demoted[0].AnchorEnd != nil {
		t.Errorf("parity: orphan anchor was not demoted to whole-essay: %+v", demoted)
	}
}
