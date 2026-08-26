// Story 6.4a (AC2/AC4/AC5/AC6/AC7 · D5/D6/D7/D15) — the PURE, storeless auto-grade
// engine. This is the golden-table unit seam: no DB, table-driven, fast. It owns the
// two correctness invariants party-mode ruled ≥6-risk (D6 classifier + D7 scorer
// denominator), so they are locked here BEFORE the submit hook is wired.
//
// GREEN (de-tagged, runs in `go test ./...`): the reds landed build-tagged
// `atdd_red_phase` before in-progress (WF-8 gate); implemented against autograde.go the
// build tag was removed so this golden-table suite is permanent regression coverage.
//
// SEAMS (dev, green phase — the ONE place to reconcile; keep signatures or update
// this header + the callers below in lockstep):
//   - grading.Grade(content store.ExerciseContent, answers grading.AttemptContent,
//         settings store.ExerciseSettings) *grading.AutoGradeResult
//       Pure: normalize → match → classify → score → band. NEVER returns an error;
//       malformed/zero-question content → nil (D13 lets the caller treat nil as
//       "ungraded, submit still commits"). Colon-handle parse per D5.
//   - grading.Normalize(s string, caseSensitive bool) string
//       TrimSpace → collapse internal whitespace runs to one space → strip hyphen
//       variants (- ‐ ‑ ‒ – —) → NFC; case-fold unless caseSensitive. Hyphen+ws
//       normalization is ALWAYS-ON (FU-4-2-A); only case is gated.
//   - classify(qType, student, correct string, variants []string, caseSensitive bool) grading.AutoMark
//       Unexported (white-box). Choice types (multiple_choice/true_false_not_given/
//       matching) are exact → MarkCorrect|MarkWrong, NEVER MarkNeedsReview.
//       Free-text (fill_in_blank/short_answer): exact-after-normalize → MarkCorrect;
//       near-miss → MarkNeedsReview; else MarkWrong. Near-miss = Levenshtein d over
//       normalized strings with 1 ≤ d ≤ min(2, ceil(L/5)), L=max(len), OR diacritics-
//       only (equal after stripping combining marks). Blank/absent → MarkWrong.
//   - grading.PercentageToBand(pct float64) float64
//       Documented percentage→band table (D7, computed-only). EXACT boundaries are
//       the dev's to finalize during red-phase; this file asserts only the STRUCTURAL
//       contract (deterministic, monotonic non-decreasing, defined on [0,100]) so it
//       does not fabricate an unfrozen table (confidence-gate).
//   - grading.HasGradableGroups(content store.ExerciseContent) bool  (D3 — presence
//         of ≥1 QuestionGroup, NOT the skill/section-type label).
//   - Types: grading.AttemptContent{ SchemaVersion int; Answers map[string]string;
//         Flagged []string } (mirrors classlite-web/.../attemptContent.ts, D5);
//         grading.AutoGradeResult{ Answers []grading.AutoGradeAnswer; RawScore,
//         MaxScore int; Percentage, ProvisionalBand float64 };
//         grading.AutoGradeAnswer{ QuestionRef, StudentAnswer string; StudentFlagged
//         bool; AutoMark grading.AutoMark }; AutoMark string const
//         MarkCorrect/MarkWrong/MarkNeedsReview.
package grading

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/store"
)

// -----------------------------------------------------------------------------
// AC6 / D6 — the FROZEN golden classifier table (Dev Notes). Comparison is over
// NORMALIZED strings; default = case-insensitive unless noted. threshold =
// min(2, ceil(L/5)), L = max(len(accepted), len(student)). This table is the
// contract: once these reds land it is frozen (Murat).
// -----------------------------------------------------------------------------

func TestClassify_FrozenGoldenTable_ATDD(t *testing.T) {
	cases := []struct {
		name          string
		qType         string
		accepted      string
		variants      []string
		student       string
		caseSensitive bool
		want          AutoMark
	}{
		{"hyphen stripped", store.QuestionGroupTypeShortAnswer, "hydroelectric", nil, "hydro-electric", false, MarkCorrect},
		{"case + collapsed ws", store.QuestionGroupTypeShortAnswer, "Hello World", nil, "hello   world", false, MarkCorrect},
		{"colour/color d1 L6 thr2", store.QuestionGroupTypeFillInBlank, "colour", nil, "color", false, MarkNeedsReview},
		{"necessary/nesessary d1 L9 thr2", store.QuestionGroupTypeFillInBlank, "necessary", nil, "nesessary", false, MarkNeedsReview},
		{"necessary/neccessarily d3 gt2", store.QuestionGroupTypeFillInBlank, "necessary", nil, "neccessarily", false, MarkWrong},
		{"cafe diacritics-only", store.QuestionGroupTypeShortAnswer, "café", nil, "cafe", false, MarkNeedsReview},
		{"cat/cot d1 L3 thr1", store.QuestionGroupTypeFillInBlank, "cat", nil, "cot", false, MarkNeedsReview},
		{"cat/dog d3 gt1", store.QuestionGroupTypeFillInBlank, "cat", nil, "dog", false, MarkWrong},
		{"goes/going d3 thr1", store.QuestionGroupTypeFillInBlank, "goes", nil, "going", false, MarkWrong},
		{"Cat/cat caseSensitive d1", store.QuestionGroupTypeFillInBlank, "Cat", nil, "cat", true, MarkNeedsReview},
		{"mcq case-fold correct", store.QuestionGroupTypeMultipleChoice, "The fox", nil, "the fox", false, MarkCorrect},
		{"mcq wrong never needs_review", store.QuestionGroupTypeMultipleChoice, "The fox", nil, "The dog", false, MarkWrong},
		{"tfng wrong choice", store.QuestionGroupTypeTrueFalseNotGiven, "true", nil, "false", false, MarkWrong},
		{"blank unanswered never needs_review", store.QuestionGroupTypeShortAnswer, "Paris", nil, "", false, MarkWrong},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := classify(tc.qType, tc.student, tc.accepted, tc.variants, tc.caseSensitive)
			if got != tc.want {
				t.Errorf("classify(%q, student=%q, accepted=%q, caseSensitive=%v) = %q, want %q",
					tc.qType, tc.student, tc.accepted, tc.caseSensitive, got, tc.want)
			}
		})
	}
}

// Choice types must NEVER return needs_review, even for a 1-edit typo that would be a
// near-miss under the free-text classifier (D5/D6 — the near-miss ladder is free-text-only).
func TestClassify_ChoiceTypes_NeverNeedsReview_ATDD(t *testing.T) {
	for _, qType := range []string{
		store.QuestionGroupTypeMultipleChoice,
		store.QuestionGroupTypeTrueFalseNotGiven,
		store.QuestionGroupTypeMatching,
	} {
		// "The fox" vs "The fax" is Levenshtein d=1 — a near-miss for free-text, but a
		// choice type must resolve it to a hard wrong.
		if got := classify(qType, "The fax", "The fox", nil, false); got != MarkWrong {
			t.Errorf("%s near-miss must be MarkWrong (choice types never needs_review), got %q", qType, got)
		}
	}
}

// Union match: the student answer matches ANY of {correctAnswer} ∪ acceptedVariants.
func TestClassify_UnionMatchAcceptedVariants_ATDD(t *testing.T) {
	if got := classify(store.QuestionGroupTypeFillInBlank, "colour", "color", []string{"colour", "coloured"}, false); got != MarkCorrect {
		t.Errorf("student=colour vs accepted∪variants{color,colour,coloured} → want MarkCorrect, got %q", got)
	}
}

// -----------------------------------------------------------------------------
// AC4 / D5 — Normalize: always-on hyphen + whitespace collapse + NFC; case gated.
// -----------------------------------------------------------------------------

func TestNormalize_HyphenAndWhitespace_AlwaysOn_ATDD(t *testing.T) {
	// En-dash and multiple spaces both collapse regardless of caseSensitive.
	for _, caseSensitive := range []bool{false, true} {
		if got := Normalize("hydro–electric", caseSensitive); got != Normalize("hydroelectric", caseSensitive) {
			t.Errorf("caseSensitive=%v: en-dash not stripped: %q vs %q", caseSensitive, got, Normalize("hydroelectric", caseSensitive))
		}
		if got := Normalize("a   b", caseSensitive); got != Normalize("a b", caseSensitive) {
			t.Errorf("caseSensitive=%v: internal whitespace runs not collapsed: %q", caseSensitive, got)
		}
	}
}

func TestNormalize_CaseGatedBySetting_ATDD(t *testing.T) {
	if Normalize("Cat", false) != Normalize("cat", false) {
		t.Error("case-insensitive: Cat and cat must normalize equal")
	}
	if Normalize("Cat", true) == Normalize("cat", true) {
		t.Error("case-sensitive: Cat and cat must NOT normalize equal")
	}
}

// -----------------------------------------------------------------------------
// AC7 / D6 — the scorer EXCLUDES unresolved needs_review from the denominator.
// percentage = resolvedCorrect / (maxScore − unresolvedNeedsReview) * 100.
// maxScore = count of gradable questions (fixed, independent of resolution).
// -----------------------------------------------------------------------------

// objectiveFixture builds a reading section with a multiple_choice group (1 q) and a
// fill_in_blank group (2 q). Colon-handles: 0:0:0 (mcq), 0:1:0, 0:1:1 (fill).
func objectiveFixture() store.ExerciseContent {
	return store.ExerciseContent{
		SchemaVersion: 1,
		Settings:      store.ExerciseSettings{},
		Sections: []store.ExerciseSection{
			{
				Type: store.SectionTypeReading,
				QuestionGroups: []store.QuestionGroup{
					{
						Type: store.QuestionGroupTypeMultipleChoice,
						Questions: []store.Question{
							{Type: store.QuestionGroupTypeMultipleChoice, Options: []string{"The fox", "The dog"}, CorrectAnswer: "The fox"},
						},
					},
					{
						Type: store.QuestionGroupTypeFillInBlank,
						Questions: []store.Question{
							{Type: store.QuestionGroupTypeFillInBlank, CorrectAnswer: "necessary"}, // student near-miss → needs_review
							{Type: store.QuestionGroupTypeFillInBlank, CorrectAnswer: "cat"},       // student dog → wrong
						},
					},
				},
			},
		},
	}
}

func TestGrade_ScorerExcludesUnresolvedNeedsReviewFromDenominator_ATDD(t *testing.T) {
	content := objectiveFixture()
	answers := AttemptContent{
		SchemaVersion: 1,
		Answers: map[string]string{
			"0:0:0": "The fox",   // correct (mcq)
			"0:1:0": "nesessary", // needs_review (d=1, L=9, thr=2)
			"0:1:1": "dog",       // wrong
		},
	}
	got := Grade(content, answers, content.Settings)
	if got == nil {
		t.Fatal("Grade returned nil for valid objective content (want a result)")
	}
	if got.MaxScore != 3 {
		t.Errorf("MaxScore = %d, want 3 (gradable-question count, fixed)", got.MaxScore)
	}
	if got.RawScore != 1 {
		t.Errorf("RawScore = %d, want 1 (only the mcq resolved correct)", got.RawScore)
	}
	// resolvedCorrect=1, unresolvedNeedsReview=1 → 1 / (3-1) = 50%.
	if got.Percentage != 50 {
		t.Errorf("Percentage = %v, want 50 (1/(3-1)*100; needs_review excluded from denom)", got.Percentage)
	}
}

// Guard: denominator would be 0 (every gradable question is an unresolved needs_review)
// → 0%, never a divide-by-zero panic (D7).
func TestGrade_AllNeedsReview_ZeroDenominatorGuard_ATDD(t *testing.T) {
	content := store.ExerciseContent{
		SchemaVersion: 1,
		Sections: []store.ExerciseSection{{
			Type: store.SectionTypeReading,
			QuestionGroups: []store.QuestionGroup{{
				Type:      store.QuestionGroupTypeFillInBlank,
				Questions: []store.Question{{Type: store.QuestionGroupTypeFillInBlank, CorrectAnswer: "necessary"}},
			}},
		}},
	}
	got := Grade(content, AttemptContent{SchemaVersion: 1, Answers: map[string]string{"0:0:0": "nesessary"}}, content.Settings)
	if got == nil {
		t.Fatal("Grade returned nil for valid content")
	}
	if got.Percentage != 0 {
		t.Errorf("all-needs_review denominator=0 must guard to 0%%, got %v", got.Percentage)
	}
}

// -----------------------------------------------------------------------------
// AC2/AC4/AC5 — colon-handle parse + per-answer marks + self-flag surfaced.
// -----------------------------------------------------------------------------

func TestGrade_ColonHandleParse_PerAnswerMarks_ATDD(t *testing.T) {
	content := objectiveFixture()
	answers := AttemptContent{
		SchemaVersion: 1,
		Answers: map[string]string{
			"0:0:0": "The fox",   // correct
			"0:1:0": "necessary", // correct (exact)
			"0:1:1": "cat",       // correct (exact)
		},
		Flagged: []string{"0:1:0"}, // the student self-flagged this one
	}
	got := Grade(content, answers, content.Settings)
	if got == nil {
		t.Fatal("Grade returned nil")
	}
	byRef := map[string]AutoGradeAnswer{}
	for _, a := range got.Answers {
		byRef[a.QuestionRef] = a
	}
	for ref, want := range map[string]AutoMark{"0:0:0": MarkCorrect, "0:1:0": MarkCorrect, "0:1:1": MarkCorrect} {
		if byRef[ref].AutoMark != want {
			t.Errorf("answer %s AutoMark = %q, want %q", ref, byRef[ref].AutoMark, want)
		}
	}
	// D5: the student's own flagged[] is informational and MUST be surfaced per-answer.
	if !byRef["0:1:0"].StudentFlagged {
		t.Error("StudentFlagged not surfaced for the self-flagged answer 0:1:0")
	}
	if byRef["0:0:0"].StudentFlagged {
		t.Error("StudentFlagged wrongly set on a non-flagged answer")
	}
}

// An absent handle (unanswered) is graded wrong, never needs_review (D6).
func TestGrade_UnansweredHandle_Wrong_ATDD(t *testing.T) {
	content := objectiveFixture()
	got := Grade(content, AttemptContent{SchemaVersion: 1, Answers: map[string]string{"0:0:0": "The fox"}}, content.Settings)
	if got == nil {
		t.Fatal("Grade returned nil")
	}
	for _, a := range got.Answers {
		if a.QuestionRef == "0:1:0" && a.AutoMark != MarkWrong {
			t.Errorf("unanswered 0:1:0 AutoMark = %q, want MarkWrong", a.AutoMark)
		}
	}
}

// -----------------------------------------------------------------------------
// D13 — the pure engine NEVER returns an error for bad data: malformed / zero-
// question / no-gradable-groups content returns nil so the submit tx still commits.
// -----------------------------------------------------------------------------

func TestGrade_ZeroQuestionContent_ReturnsNil_ATDD(t *testing.T) {
	empty := store.ExerciseContent{SchemaVersion: 1, Sections: []store.ExerciseSection{}}
	if got := Grade(empty, AttemptContent{SchemaVersion: 1, Answers: map[string]string{}}, empty.Settings); got != nil {
		t.Errorf("Grade on zero-question content must return nil (D13), got %+v", got)
	}
}

// -----------------------------------------------------------------------------
// D3 — objective detection is by QuestionGroup PRESENCE, not skill/section label.
// -----------------------------------------------------------------------------

func TestHasGradableGroups_ByPresenceNotSkill_ATDD(t *testing.T) {
	if !HasGradableGroups(objectiveFixture()) {
		t.Error("a section with question groups must be gradable")
	}
	// A writing/speaking-style content with zero groups is NOT gradable.
	promptOnly := store.ExerciseContent{
		SchemaVersion: 1,
		Sections:      []store.ExerciseSection{{Type: store.SectionTypeWriting, QuestionGroups: nil}},
	}
	if HasGradableGroups(promptOnly) {
		t.Error("a prompt-only (no question groups) content must NOT be gradable (D3)")
	}
}

// -----------------------------------------------------------------------------
// AC7 / D7 — PercentageToBand structural contract only (exact table is dev-owned,
// not fabricated here). Deterministic + monotonic non-decreasing over [0,100].
// -----------------------------------------------------------------------------

func TestPercentageToBand_DeterministicAndMonotonic_ATDD(t *testing.T) {
	prev := PercentageToBand(0)
	if PercentageToBand(0) != prev {
		t.Fatal("PercentageToBand must be deterministic")
	}
	for pct := 0; pct <= 100; pct += 5 {
		b := PercentageToBand(float64(pct))
		if b < prev {
			t.Errorf("band non-monotonic: PercentageToBand(%d)=%v < previous %v", pct, b, prev)
		}
		prev = b
	}
}
