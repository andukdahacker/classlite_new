// Story 4.2 — ValidateExerciseContent{Structural,Complete} units (T1 / AC7 /
// Decision B). Table-driven, adversarial: every per-type invariant, valid +
// violating. The contract is a typed model.ValidationError (never a panic,
// never a bare error) carrying one FieldError per violation.
//
// The two tiers are the load-bearing distinction (FU-4-2-B): STRUCTURAL runs on
// every 1500ms autosave and must PERMIT an in-progress draft; COMPLETENESS is
// the finalize gate. So a completeness violation must pass structural and fail
// complete — that asymmetry is what these tests pin.
package store

import (
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
)

// mcqQuestion builds a minimal valid MCQ question.
func mcqQuestion(correct string, opts ...string) Question {
	return Question{Text: "q", Type: "mc", Options: opts, CorrectAnswer: correct}
}

func tfngQuestion(correct string) Question {
	return Question{Text: "statement", Type: "tfng", CorrectAnswer: correct}
}

func gapQuestion(correct string) Question {
	return Question{Text: "The ______ is here.", Type: "gap", CorrectAnswer: correct}
}

func matchingQuestion(correct string, bank ...string) Question {
	return Question{Text: "para A", Type: "match", Options: bank, CorrectAnswer: correct}
}

func section(sType string, groups ...QuestionGroup) ExerciseSection {
	return ExerciseSection{Type: sType, Title: "S", Content: "c", QuestionGroups: groups}
}

func group(gType string, qs ...Question) QuestionGroup {
	return QuestionGroup{Type: gType, Instructions: "do", Questions: qs}
}

func contentOf(sections ...ExerciseSection) ExerciseContent {
	return ExerciseContent{SchemaVersion: 1, Sections: sections, Settings: ExerciseSettings{}}
}

// assertValidationCode asserts err is a model.ValidationError carrying at least
// one FieldError whose Code matches wantCode.
func assertValidationCode(t *testing.T, err error, wantCode string) {
	t.Helper()
	if err == nil {
		t.Fatalf("expected a validation error with code %q, got nil", wantCode)
	}
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("error type = %T, want model.ValidationError (never a panic/bare error)", err)
	}
	for _, f := range verr.Fields {
		if f.Code == wantCode {
			return
		}
	}
	t.Fatalf("no FieldError with code %q; got %+v", wantCode, verr.Fields)
}

// assertNoError fails when a validation that should pass returns an error.
func assertNoError(t *testing.T, err error, ctx string) {
	t.Helper()
	if err != nil {
		t.Fatalf("%s: expected no validation error, got %v", ctx, err)
	}
}

// completeValidDocument is a fully-populated, finalizable exercise — it must
// pass BOTH the structural (autosave) and the complete (finalize) gate.
func completeValidDocument() ExerciseContent {
	return contentOf(
		section(SectionTypeReading,
			group(QuestionGroupTypeMultipleChoice, mcqQuestion("Paris", "Paris", "London")),
			group(QuestionGroupTypeTrueFalseNotGiven, tfngQuestion("notGiven")),
		),
		section(SectionTypeGrammar,
			group(QuestionGroupTypeFillInBlank, gapQuestion("answer")),
			group(QuestionGroupTypeShortAnswer, Question{Text: "why?", CorrectAnswer: "because"}),
		),
		section(SectionTypeListening,
			group(QuestionGroupTypeMatching, matchingQuestion("i", "i", "ii", "iii")),
		),
		section(SectionTypeWriting), // prompt-only, no groups
		section(SectionTypeSpeaking),
	)
}

func TestValidateExerciseContent_CompleteDocumentPassesBothGates(t *testing.T) {
	c := completeValidDocument()
	assertNoError(t, ValidateExerciseContentStructural(c), "structural")
	assertNoError(t, ValidateExerciseContentComplete(c), "complete")
}

// TestValidateExerciseContentStructural_Violations covers the MALFORMED cases
// that must 422 on EVERY autosave (and, being structural, also fail the complete
// gate).
func TestValidateExerciseContentStructural_Violations(t *testing.T) {
	tests := []struct {
		name     string
		content  ExerciseContent
		wantCode string
	}{
		{
			name:     "unknown section type",
			content:  contentOf(section("crossword")),
			wantCode: "INVALID_SECTION_TYPE",
		},
		{
			name:     "vocabulary section is not enabled (declared constant, not in the 5-set)",
			content:  contentOf(section(SectionTypeVocabulary, group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: "a"}))),
			wantCode: "INVALID_SECTION_TYPE",
		},
		{
			name:     "writing section carries groups",
			content:  contentOf(ExerciseSection{Type: SectionTypeWriting, Title: "W", QuestionGroups: []QuestionGroup{group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: "a"})}}),
			wantCode: "SECTION_TYPE_FORBIDS_GROUPS",
		},
		{
			name:     "speaking section carries groups",
			content:  contentOf(ExerciseSection{Type: SectionTypeSpeaking, Title: "S", QuestionGroups: []QuestionGroup{group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: "a"})}}),
			wantCode: "SECTION_TYPE_FORBIDS_GROUPS",
		},
		{
			name:     "unknown group type",
			content:  contentOf(section(SectionTypeReading, group("essay", Question{Text: "q", CorrectAnswer: "a"}))),
			wantCode: "INVALID_GROUP_TYPE",
		},
		{
			name:     "T/F/NG non-blank answer outside the triad is garbage",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeTrueFalseNotGiven, tfngQuestion("maybe")))),
			wantCode: "INVALID_TFNG_ANSWER",
		},
		{
			name:     "T/F/NG carries forbidden options (Decision 2 — strict-reject)",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeTrueFalseNotGiven, Question{Text: "s", CorrectAnswer: "true", Options: []string{"yes", "no"}}))),
			wantCode: "TFNG_FORBIDS_OPTIONS",
		},
		{
			name:     "MCQ carries forbidden accepted variants (Decision 2)",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, Question{Text: "q", Options: []string{"a", "b"}, CorrectAnswer: "a", AcceptedVariants: []string{"x"}}))),
			wantCode: "CHOICE_FORBIDS_VARIANTS",
		},
		{
			name:     "short-answer carries forbidden options (Decision 2)",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: "cold", Options: []string{"a"}}))),
			wantCode: "TEXT_ANSWER_FORBIDS_OPTIONS",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			assertValidationCode(t, ValidateExerciseContentStructural(tc.content), tc.wantCode)
			// A structural violation is also a completeness violation.
			assertValidationCode(t, ValidateExerciseContentComplete(tc.content), tc.wantCode)
		})
	}
}

// TestValidateExerciseContentComplete_Violations covers the COMPLETENESS cases:
// each is a valid in-progress DRAFT (passes structural / autosave persists it)
// but is rejected at the finalize gate.
func TestValidateExerciseContentComplete_Violations(t *testing.T) {
	tests := []struct {
		name     string
		content  ExerciseContent
		wantCode string
	}{
		{
			name:     "non-prompt section with zero groups",
			content:  contentOf(section(SectionTypeReading)),
			wantCode: "SECTION_REQUIRES_GROUP",
		},
		{
			name:     "group with zero questions",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeShortAnswer))),
			wantCode: "GROUP_REQUIRES_QUESTION",
		},
		{
			name:     "MCQ fewer than two options",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, mcqQuestion("Paris", "Paris")))),
			wantCode: "MCQ_TOO_FEW_OPTIONS",
		},
		{
			name:     "MCQ duplicate options",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, mcqQuestion("Paris", "Paris", "Paris")))),
			wantCode: "MCQ_DUPLICATE_OPTIONS",
		},
		{
			name:     "MCQ blank option",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, mcqQuestion("Paris", "Paris", "  ")))),
			wantCode: "MCQ_BLANK_OPTION",
		},
		{
			name:     "MCQ correct answer not in options",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, mcqQuestion("Berlin", "Paris", "London")))),
			wantCode: "MCQ_CORRECT_NOT_IN_OPTIONS",
		},
		{
			name:     "Matching empty bank",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMatching, matchingQuestion("i")))),
			wantCode: "MATCHING_EMPTY_BANK",
		},
		{
			name:     "Matching blank heading in the bank",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMatching, matchingQuestion("ii", "i", "  ", "ii")))),
			wantCode: "MATCHING_BLANK_HEADING",
		},
		{
			name:     "Matching correct answer not in bank",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeMatching, matchingQuestion("iv", "i", "ii", "iii")))),
			wantCode: "MATCHING_CORRECT_NOT_IN_BANK",
		},
		{
			name:     "T/F/NG blank answer (not yet marked)",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeTrueFalseNotGiven, tfngQuestion("")))),
			wantCode: "INVALID_TFNG_ANSWER",
		},
		{
			name:     "Gap-fill blank correct answer (spaces)",
			content:  contentOf(section(SectionTypeGrammar, group(QuestionGroupTypeFillInBlank, gapQuestion("   ")))),
			wantCode: "BLANK_CORRECT_ANSWER",
		},
		{
			name:     "Gap-fill zero-width-space correct answer",
			content:  contentOf(section(SectionTypeGrammar, group(QuestionGroupTypeFillInBlank, gapQuestion("​")))),
			wantCode: "BLANK_CORRECT_ANSWER",
		},
		{
			name:     "Gap-fill word-joiner (U+2060) correct answer is blank",
			content:  contentOf(section(SectionTypeGrammar, group(QuestionGroupTypeFillInBlank, gapQuestion("⁠")))),
			wantCode: "BLANK_CORRECT_ANSWER",
		},
		{
			name:     "Short-answer nbsp-only correct answer",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: " "}))),
			wantCode: "BLANK_CORRECT_ANSWER",
		},
		{
			name:     "Gap-fill blank accepted variant",
			content:  contentOf(section(SectionTypeGrammar, group(QuestionGroupTypeFillInBlank, Question{Text: "q", CorrectAnswer: "cold", AcceptedVariants: []string{"cool", "  "}}))),
			wantCode: "BLANK_ACCEPTED_VARIANT",
		},
		{
			name:     "time limit enabled with zero minutes",
			content:  ExerciseContent{SchemaVersion: 1, Settings: ExerciseSettings{TimeLimitEnabled: true, TimeLimitMinutes: 0}},
			wantCode: "TIME_LIMIT_REQUIRES_MINUTES",
		},
		{
			name:     "question with a blank stem (Review P4)",
			content:  contentOf(section(SectionTypeReading, group(QuestionGroupTypeShortAnswer, Question{Text: "  ", CorrectAnswer: "a"}))),
			wantCode: "BLANK_QUESTION_TEXT",
		},
		{
			name:     "writing section with a blank prompt (Review P4)",
			content:  contentOf(ExerciseSection{Type: SectionTypeWriting, Title: "W", Content: "   "}),
			wantCode: "SECTION_REQUIRES_PROMPT",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// The draft persists on autosave...
			assertNoError(t, ValidateExerciseContentStructural(tc.content), "structural (draft must persist)")
			// ...but is caught at the finalize gate.
			assertValidationCode(t, ValidateExerciseContentComplete(tc.content), tc.wantCode)
		})
	}
}

func TestValidateExerciseContentStructural_CollectionCaps(t *testing.T) {
	// Caps are structural — they must hold on every autosave.

	// Too many sections.
	tooManySections := make([]ExerciseSection, maxSectionsPerExercise+1)
	for i := range tooManySections {
		tooManySections[i] = section(SectionTypeWriting)
	}
	assertValidationCode(t, ValidateExerciseContentStructural(contentOf(tooManySections...)), "TOO_MANY_SECTIONS")

	// Too many groups in a section.
	tooManyGroups := make([]QuestionGroup, maxGroupsPerSection+1)
	for i := range tooManyGroups {
		tooManyGroups[i] = group(QuestionGroupTypeShortAnswer, Question{Text: "q", CorrectAnswer: "a"})
	}
	assertValidationCode(t, ValidateExerciseContentStructural(contentOf(section(SectionTypeReading, tooManyGroups...))), "TOO_MANY_GROUPS")

	// Too many questions in a group.
	tooManyQuestions := make([]Question, maxQuestionsPerGroup+1)
	for i := range tooManyQuestions {
		tooManyQuestions[i] = Question{Text: "q", CorrectAnswer: "a"}
	}
	assertValidationCode(t, ValidateExerciseContentStructural(contentOf(section(SectionTypeReading, group(QuestionGroupTypeShortAnswer, tooManyQuestions...)))), "TOO_MANY_QUESTIONS")

	// Too many options on an MCQ question.
	tooManyOptions := make([]string, maxOptionsPerQuestion+1)
	for i := range tooManyOptions {
		tooManyOptions[i] = string(rune('a'+i%26)) + strings.Repeat("x", i)
	}
	assertValidationCode(t,
		ValidateExerciseContentStructural(contentOf(section(SectionTypeReading, group(QuestionGroupTypeMultipleChoice, mcqQuestion(tooManyOptions[0], tooManyOptions...))))),
		"TOO_MANY_OPTIONS")
}

// TestValidateExerciseContent_Settings covers the settings block (P1, code
// review 2026-07-28). Negative/absurd is structural (autosave rejects it);
// enabled-with-zero-minutes is completeness (finalize only).
func TestValidateExerciseContent_Settings(t *testing.T) {
	settingsContent := func(s ExerciseSettings) ExerciseContent {
		return ExerciseContent{SchemaVersion: 1, Settings: s}
	}

	// Every FR-22 default equals the Go zero value — an unset block is valid.
	assertNoError(t, ValidateExerciseContentStructural(settingsContent(ExerciseSettings{})), "structural: zero settings")
	assertNoError(t, ValidateExerciseContentComplete(settingsContent(ExerciseSettings{})), "complete: zero settings")
	// A disabled timer with a positive minutes value is still valid.
	assertNoError(t, ValidateExerciseContentComplete(settingsContent(ExerciseSettings{TimeLimitMinutes: 30})), "complete: disabled +minutes")

	// Structural (autosave rejects):
	assertValidationCode(t, ValidateExerciseContentStructural(settingsContent(ExerciseSettings{TimeLimitMinutes: -5})), "NEGATIVE_TIME_LIMIT")
	assertValidationCode(t, ValidateExerciseContentStructural(settingsContent(ExerciseSettings{TimeLimitMinutes: maxTimeLimitMinutes + 1})), "TIME_LIMIT_TOO_LONG")

	// Completeness (autosave permits, finalize rejects):
	enabledZero := settingsContent(ExerciseSettings{TimeLimitEnabled: true, TimeLimitMinutes: 0})
	assertNoError(t, ValidateExerciseContentStructural(enabledZero), "structural: enabled+0 is a draft")
	assertValidationCode(t, ValidateExerciseContentComplete(enabledZero), "TIME_LIMIT_REQUIRES_MINUTES")
}

func TestValidateExerciseContentComplete_CollectsMultipleFieldErrors(t *testing.T) {
	c := contentOf(
		section(SectionTypeReading,
			group(QuestionGroupTypeMultipleChoice, mcqQuestion("Berlin", "Paris")), // too few AND correct-not-in (completeness)
			group(QuestionGroupTypeTrueFalseNotGiven, tfngQuestion("nope")),        // bad triad (structural)
		),
	)
	err := ValidateExerciseContentComplete(c)
	var verr model.ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("error type = %T, want model.ValidationError", err)
	}
	if len(verr.Fields) < 2 {
		t.Fatalf("expected multiple field errors, got %d: %+v", len(verr.Fields), verr.Fields)
	}
}

func TestValidateExerciseContent_NoPanicOnDeepNesting(t *testing.T) {
	// A fully-populated-but-invalid shape must produce a typed error, not a panic
	// — through BOTH gates.
	defer func() {
		if r := recover(); r != nil {
			t.Fatalf("ValidateExerciseContent panicked: %v", r)
		}
	}()
	c := contentOf(section(SectionTypeReading, group(QuestionGroupTypeMatching, Question{})))
	_ = ValidateExerciseContentStructural(c)
	_ = ValidateExerciseContentComplete(c)
}
