package service

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/service/grading"
	"github.com/ducdo/classlite-api/internal/store"
)

// TestBuildAutoGradeView_ReleasedProjectionMatchesDefinitive is the Task-1 (#1=A) unit
// proof that AutoGradeView.ReleasedProjection is the definitive as-if-released score/band
// (unresolved needs_review counts as wrong over the FULL denominator) REGARDLESS of the
// pre/post-release flag — so the 6-4b reckoning dialog can read it verbatim (D3/D9).
func TestBuildAutoGradeView_ReleasedProjectionMatchesDefinitive(t *testing.T) {
	needsReview := string(grading.MarkNeedsReview)
	answers := []store.AutoGradeAnswer{
		{QuestionRef: "0:0:0", AutoMark: string(grading.MarkCorrect)},
		{QuestionRef: "0:0:1", AutoMark: string(grading.MarkCorrect)},
		{QuestionRef: "1:0:0", AutoMark: needsReview}, // unresolved — excluded from provisional, wrong at release
	}

	defRaw, _, _, defBand := definitiveScore(answers)

	// Pre-release: the view is scored provisionally, but the projection is ALWAYS definitive.
	pre := buildAutoGradeView(store.ExerciseContent{}, answers, false)
	if pre.Released {
		t.Fatalf("pre-release view Released = true, want false")
	}
	if pre.ReleasedProjection.RawScore != defRaw || pre.ReleasedProjection.Band != defBand {
		t.Errorf("pre-release ReleasedProjection = {%d, %v}, want definitive {%d, %v}",
			pre.ReleasedProjection.RawScore, pre.ReleasedProjection.Band, defRaw, defBand)
	}
	// The provisional band (needs_review excluded: 2/2 = 100%%) must differ from the
	// definitive projection (needs_review wrong: 2/3) — else the fixture proves nothing.
	if pre.ProvisionalBand == pre.ReleasedProjection.Band {
		t.Errorf("provisional band %v == projection band %v — fixture must exercise the drop",
			pre.ProvisionalBand, pre.ReleasedProjection.Band)
	}

	// Post-release: the view itself is definitive, and the projection equals it.
	post := buildAutoGradeView(store.ExerciseContent{}, answers, true)
	if post.ReleasedProjection.RawScore != post.RawScore || post.ReleasedProjection.Band != post.ProvisionalBand {
		t.Errorf("post-release projection {%d, %v} != released grade {%d, %v}",
			post.ReleasedProjection.RawScore, post.ReleasedProjection.Band, post.RawScore, post.ProvisionalBand)
	}
}
