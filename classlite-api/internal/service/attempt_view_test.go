// Story 5.2a (AC10,11,12) — answer-strip mapper unit tests. White-box (package
// service) so the unexported toAttemptExercise ladder is exercised directly. The
// SEC property (no correctAnswer/acceptedVariants) is compile-time guaranteed at
// this layer — AttemptQuestion has no such fields — so these tests pin the OTHER
// half: every student-safe field IS copied, ordering is preserved across all five
// group types, and prompt-only (empty questionGroups) sections round-trip intact.
package service

import (
	"testing"

	"github.com/ducdo/classlite-api/internal/store"
	"github.com/google/uuid"
)

// fullExerciseContent builds a content blob carrying all five question-group types
// with KNOWN correctAnswer/acceptedVariants values, plus a prompt-only writing
// section, so the strip + passthrough can both be asserted.
func fullExerciseContent() store.ExerciseContent {
	return store.ExerciseContent{
		SchemaVersion: 1,
		Sections: []store.ExerciseSection{
			{
				Type:    store.SectionTypeReading,
				Title:   "Passage 1",
				Content: "The reading passage text.",
				QuestionGroups: []store.QuestionGroup{
					{
						Type:         store.QuestionGroupTypeMultipleChoice,
						Instructions: "Choose A, B, C or D.",
						Questions: []store.Question{
							{Text: "Q-mcq", Type: "multiple_choice", Options: []string{"A", "B", "C", "D"}, CorrectAnswer: "B", AcceptedVariants: []string{}},
						},
					},
					{
						Type:         store.QuestionGroupTypeTrueFalseNotGiven,
						Instructions: "TRUE / FALSE / NOT GIVEN.",
						Questions: []store.Question{
							{Text: "Q-tfng", Type: "true_false_not_given", Options: []string{}, CorrectAnswer: "notGiven", AcceptedVariants: []string{}},
						},
					},
					{
						Type:         store.QuestionGroupTypeFillInBlank,
						Instructions: "Fill the gap.",
						Questions: []store.Question{
							{Text: "Q-gap", Type: "fill_in_blank", Options: []string{}, CorrectAnswer: "colour", AcceptedVariants: []string{"color"}},
						},
					},
					{
						Type:         store.QuestionGroupTypeShortAnswer,
						Instructions: "One word only.",
						Questions: []store.Question{
							{Text: "Q-short", Type: "short_answer", Options: []string{}, CorrectAnswer: "seventeen", AcceptedVariants: []string{"17"}},
						},
					},
					{
						Type:         store.QuestionGroupTypeMatching,
						Instructions: "Match headings.",
						Questions: []store.Question{
							{Text: "Q-match", Type: "matching", Options: []string{"i", "ii", "iii"}, CorrectAnswer: "ii", AcceptedVariants: []string{}},
						},
					},
				},
			},
			{
				// Prompt-only writing section — empty questionGroups (AC12 passthrough).
				Type:           store.SectionTypeWriting,
				Title:          "Task 2",
				Content:        "Write at least 250 words about …",
				QuestionGroups: []store.QuestionGroup{},
			},
		},
		Settings: store.ExerciseSettings{TimeLimitEnabled: true, TimeLimitMinutes: 60, CaseSensitive: false},
	}
}

func TestToAttemptExercise_CopiesStudentSafeFields(t *testing.T) {
	id := uuid.New()
	got := toAttemptExercise(fullExerciseContent(), id, "IELTS Reading Test", "reading")

	if got.ID != id.String() {
		t.Errorf("id = %q, want %q", got.ID, id.String())
	}
	if got.Title != "IELTS Reading Test" {
		t.Errorf("title = %q", got.Title)
	}
	if got.Skill != "reading" {
		t.Errorf("skill = %q", got.Skill)
	}
	if got.Settings.TimeLimitMinutes != 60 || !got.Settings.TimeLimitEnabled {
		t.Errorf("settings not carried: %+v", got.Settings)
	}
	if len(got.Sections) != 2 {
		t.Fatalf("sections = %d, want 2", len(got.Sections))
	}

	sec0 := got.Sections[0]
	if sec0.Type != "reading" || sec0.Title != "Passage 1" || sec0.Content != "The reading passage text." {
		t.Errorf("section 0 fields not carried: %+v", sec0)
	}
	if len(sec0.QuestionGroups) != 5 {
		t.Fatalf("section 0 groups = %d, want 5 (one per type)", len(sec0.QuestionGroups))
	}

	// MCQ group: options + text carried; group type + instructions carried.
	mcq := sec0.QuestionGroups[0]
	if mcq.Type != "multiple_choice" || mcq.Instructions != "Choose A, B, C or D." {
		t.Errorf("mcq group meta not carried: %+v", mcq)
	}
	if len(mcq.Questions) != 1 || mcq.Questions[0].Text != "Q-mcq" {
		t.Fatalf("mcq question not carried: %+v", mcq.Questions)
	}
	if got, want := mcq.Questions[0].Options, []string{"A", "B", "C", "D"}; !equalStrings(got, want) {
		t.Errorf("mcq options = %v, want %v", got, want)
	}
}

func TestToAttemptExercise_PreservesOrderingAllTypes(t *testing.T) {
	got := toAttemptExercise(fullExerciseContent(), uuid.New(), "T", "reading")
	wantTypes := []string{"multiple_choice", "true_false_not_given", "fill_in_blank", "short_answer", "matching"}
	groups := got.Sections[0].QuestionGroups
	for i, want := range wantTypes {
		if groups[i].Type != want {
			t.Errorf("group[%d].type = %q, want %q (ordering not preserved)", i, groups[i].Type, want)
		}
	}
}

func TestToAttemptExercise_PromptOnlySectionPassesThrough(t *testing.T) {
	got := toAttemptExercise(fullExerciseContent(), uuid.New(), "T", "writing")
	writing := got.Sections[1]
	if writing.Type != "writing" || writing.Content != "Write at least 250 words about …" {
		t.Errorf("prompt-only section not preserved: %+v", writing)
	}
	if writing.QuestionGroups == nil {
		t.Error("prompt-only questionGroups is nil — must serialize as [] not null (GO-5)")
	}
	if len(writing.QuestionGroups) != 0 {
		t.Errorf("prompt-only section has %d groups, want 0", len(writing.QuestionGroups))
	}
}

func TestToAttemptExercise_NilOptionsBecomeEmptySlice(t *testing.T) {
	content := store.ExerciseContent{
		SchemaVersion: 1,
		Sections: []store.ExerciseSection{{
			Type: store.SectionTypeReading, Title: "S", Content: "c",
			QuestionGroups: []store.QuestionGroup{{
				Type: store.QuestionGroupTypeShortAnswer, Instructions: "i",
				Questions: []store.Question{{Text: "q", Type: "short_answer", Options: nil, CorrectAnswer: "x"}},
			}},
		}},
		Settings: store.ExerciseSettings{},
	}
	got := toAttemptExercise(content, uuid.New(), "T", "reading")
	opts := got.Sections[0].QuestionGroups[0].Questions[0].Options
	if opts == nil {
		t.Error("nil Options must map to a non-nil empty slice (GO-5 — []  not null)")
	}
	if len(opts) != 0 {
		t.Errorf("options = %v, want empty", opts)
	}
}

func equalStrings(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}
