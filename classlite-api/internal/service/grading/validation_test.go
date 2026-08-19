package grading

import "testing"

func ptr(i int) *int { return &i }

// spanComment builds a suggestion comment anchored to [start,end).
func spanComment(start, end int) Comment {
	return Comment{
		Type: CommentTypeSuggestion, Criterion: CriterionTaskResponse,
		AnchorStart: ptr(start), AnchorEnd: ptr(end), Text: "note",
	}
}

// TestNormalizeComments_SurrogatePairBoundary covers the P4 fix: an anchor boundary
// that splits an emoji's surrogate pair (UTF-16) is demoted to whole-essay, while a
// span that fully brackets the emoji is kept. Essay "Hi 😀 there": UTF-16 units are
// H(0) i(1) ␣(2) [😀 = 3,4] ␣(5) t(6)... — the emoji occupies units 3 and 4.
func TestNormalizeComments_SurrogatePairBoundary(t *testing.T) {
	const essay = "Hi 😀 there"

	cases := []struct {
		name       string
		start, end int
		wantAnchor bool // true → span kept, false → demoted to whole-essay
	}{
		{"before emoji", 0, 3, true},
		{"brackets emoji fully", 3, 5, true},
		{"end splits surrogate", 0, 4, false},
		{"start splits surrogate", 4, 6, false},
		{"spans across whole emoji", 2, 6, true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			out, err := NormalizeComments([]Comment{spanComment(tc.start, tc.end)}, essay)
			if err != nil {
				t.Fatalf("NormalizeComments: %v", err)
			}
			if len(out) != 1 {
				t.Fatalf("got %d comments, want 1", len(out))
			}
			gotAnchor := out[0].AnchorStart != nil && out[0].AnchorEnd != nil
			if gotAnchor != tc.wantAnchor {
				t.Errorf("anchor kept = %v, want %v (start=%d end=%d)", gotAnchor, tc.wantAnchor, tc.start, tc.end)
			}
			if tc.wantAnchor && (*out[0].AnchorStart != tc.start || *out[0].AnchorEnd != tc.end) {
				t.Errorf("anchor = [%d,%d), want [%d,%d)", *out[0].AnchorStart, *out[0].AnchorEnd, tc.start, tc.end)
			}
		})
	}
}

// TestNormalizeComments_OutOfRangeDemotes confirms the existing demotion contract is
// intact alongside the new surrogate guard.
func TestNormalizeComments_OutOfRangeDemotes(t *testing.T) {
	const essay = "short"
	out, err := NormalizeComments([]Comment{spanComment(0, 99)}, essay)
	if err != nil {
		t.Fatalf("NormalizeComments: %v", err)
	}
	if out[0].AnchorStart != nil || out[0].AnchorEnd != nil {
		t.Errorf("out-of-range anchor should demote to whole-essay, got [%v,%v]", out[0].AnchorStart, out[0].AnchorEnd)
	}
}
