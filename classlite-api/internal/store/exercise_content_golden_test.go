// Story 4.2 — golden-contract test (T4, Murat 6/9). The v1 ExerciseContent wire
// shape is shared by the Go server, the api.yaml schema, and the frontend MSW
// mocks. This test pins the Go marshal output to a SINGLE canonical fixture
// committed under the web tree (classlite-web/.../fixtures/exercise-content.golden.json)
// that the FE imports for its MSW doubles — so a nested-key or casing drift on
// EITHER side breaks a test instead of silently desyncing the two repos.
//
// Reading a data file across the service boundary is not a source import
// (WF-7): the JSON is a shared CONTRACT artifact, the same role api.yaml plays.
package store

import (
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

// goldenContentFixturePath is relative to this package dir (internal/store):
// three levels up to the repo root, then into the web fixtures dir.
const goldenContentFixturePath = "../../../classlite-web/src/features/exercises/__tests__/fixtures/exercise-content.golden.json"

// goldenExerciseContent is the Go-struct twin of the shared JSON fixture. If the
// two drift, the DeepEqual assertion below fails.
func goldenExerciseContent() ExerciseContent {
	return ExerciseContent{
		SchemaVersion: CurrentExerciseSchemaVersion,
		Sections: []ExerciseSection{
			{
				Type: SectionTypeReading, Title: "Passage 1",
				Content: "The quick brown fox jumps over the lazy dog.",
				QuestionGroups: []QuestionGroup{
					{
						Type: QuestionGroupTypeMultipleChoice, Instructions: "Choose the best answer.",
						Questions: []Question{{
							Text: "What jumps?", Type: "multiple_choice",
							Options: []string{"The fox", "The dog"}, CorrectAnswer: "The fox", AcceptedVariants: []string{},
						}},
					},
					{
						Type: QuestionGroupTypeTrueFalseNotGiven, Instructions: "True, False or Not Given.",
						Questions: []Question{{
							Text: "The dog is lazy.", Type: "true_false_not_given",
							Options: []string{}, CorrectAnswer: "true", AcceptedVariants: []string{},
						}},
					},
				},
			},
			{
				Type: SectionTypeGrammar, Title: "Tenses", Content: "Complete each sentence.",
				QuestionGroups: []QuestionGroup{
					{
						Type: QuestionGroupTypeFillInBlank, Instructions: "Fill the blank.",
						Questions: []Question{{
							Text: "She ______ to school every day.", Type: "fill_in_blank",
							Options: []string{}, CorrectAnswer: "goes", AcceptedVariants: []string{"walks"},
						}},
					},
					{
						Type: QuestionGroupTypeShortAnswer, Instructions: "Answer in one word.",
						Questions: []Question{{
							Text: "Antonym of hot?", Type: "short_answer",
							Options: []string{}, CorrectAnswer: "cold", AcceptedVariants: []string{"cool"},
						}},
					},
				},
			},
			{
				Type: SectionTypeListening, Title: "Section 2", Content: "https://example.com/audio.mp3",
				QuestionGroups: []QuestionGroup{{
					Type: QuestionGroupTypeMatching, Instructions: "Match the heading.",
					Questions: []Question{{
						Text: "Paragraph A", Type: "matching",
						Options: []string{"i", "ii", "iii"}, CorrectAnswer: "ii", AcceptedVariants: []string{},
					}},
				}},
			},
			{Type: SectionTypeWriting, Title: "Task 1", Content: "Describe the chart in 150 words.", QuestionGroups: []QuestionGroup{}},
			{Type: SectionTypeSpeaking, Title: "Part 2", Content: "Describe a place you like to visit.", QuestionGroups: []QuestionGroup{}},
		},
		Settings: ExerciseSettings{TimeLimitEnabled: true, TimeLimitMinutes: 45, CaseSensitive: true},
	}
}

func TestExerciseContent_GoldenContract_MatchesSharedFixture(t *testing.T) {
	raw, err := os.ReadFile(filepath.FromSlash(goldenContentFixturePath))
	if err != nil {
		t.Fatalf("read shared fixture (%s): %v", goldenContentFixturePath, err)
	}

	// The shared fixture must decode into the Go struct AND equal the Go twin —
	// a nested-key rename or casing drift on either side fails here.
	decoded, err := UnmarshalExerciseContent(raw, CurrentExerciseSchemaVersion)
	if err != nil {
		t.Fatalf("shared fixture does not decode as v1: %v", err)
	}
	if !reflect.DeepEqual(decoded, goldenExerciseContent()) {
		t.Fatalf("shared fixture decoded != Go golden twin\n got: %+v\nwant: %+v", decoded, goldenExerciseContent())
	}

	// The Go marshal output must be byte-equal to the fixture (after both are
	// compacted) — pins camelCase key names + field presence.
	goMarshaled, err := goldenExerciseContent().Marshal()
	if err != nil {
		t.Fatalf("marshal go golden: %v", err)
	}
	var fixtureCompact bytes.Buffer
	if err := json.Compact(&fixtureCompact, raw); err != nil {
		t.Fatalf("compact fixture: %v", err)
	}
	if !bytes.Equal(goMarshaled, fixtureCompact.Bytes()) {
		t.Fatalf("marshal drift:\n go:      %s\n fixture: %s", goMarshaled, fixtureCompact.Bytes())
	}

	// The shared fixture MUST be a COMPLETE, finalizable document (FE MSW relies
	// on it as a realistic 200 body, and it is the canonical fully-valid example).
	if err := ValidateExerciseContentComplete(decoded); err != nil {
		t.Fatalf("shared fixture is not a complete v1 document: %v", err)
	}

	// No snake_case leak in the nested content keys (the whole point of the gate).
	s := string(goMarshaled)
	for _, snake := range []string{"question_groups", "correct_answer", "accepted_variants", "time_limit_enabled", "case_sensitive"} {
		if strings.Contains(s, snake) {
			t.Errorf("marshaled content leaked a snake_case key %q: %s", snake, s)
		}
	}
	// schema_version is column-canonical (json:"-") — never in the blob.
	if strings.Contains(s, "schemaVersion") || strings.Contains(s, "schema_version") {
		t.Errorf("marshaled content must NOT carry the schema version: %s", s)
	}
}
