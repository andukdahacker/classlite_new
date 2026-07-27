// Story 4.1 — v1 ExerciseContent contract units (T6 / AC6). No DB: pure
// (de)serialization + version-dispatch + count behavior. The version-dispatch
// negative cases (NULL/0/unknown) MUST be typed errors, never panics.
package store

import (
	"errors"
	"strings"
	"testing"
)

func TestNewExerciseContentShell_EmptyCountsAndDefaultSettings(t *testing.T) {
	shell := NewExerciseContentShell()
	if shell.SchemaVersion != CurrentExerciseSchemaVersion {
		t.Errorf("shell version = %d, want %d", shell.SchemaVersion, CurrentExerciseSchemaVersion)
	}
	if shell.SectionCount() != 0 || shell.QuestionCount() != 0 {
		t.Errorf("shell counts = %d/%d, want 0/0", shell.SectionCount(), shell.QuestionCount())
	}
	// FR-22 defaults coincide with the Go zero value (trap designed out).
	if shell.Settings.TimeLimitEnabled || shell.Settings.TimeLimitMinutes != 0 || shell.Settings.CaseSensitive {
		t.Errorf("shell settings = %+v, want all zero/default", shell.Settings)
	}
}

func TestExerciseContentShell_MarshalsSectionsAsEmptyArrayNotNull(t *testing.T) {
	raw, err := NewExerciseContentShell().Marshal()
	if err != nil {
		t.Fatalf("marshal shell: %v", err)
	}
	s := string(raw)
	if !strings.Contains(s, `"sections":[]`) {
		t.Errorf("shell blob = %s, want a non-null empty sections array", s)
	}
	if !strings.Contains(s, `"settings":`) {
		t.Errorf("shell blob = %s, want an embedded settings object", s)
	}
	// schema_version is json:"-" — it must NOT leak into the blob (no dual source).
	if strings.Contains(s, "schemaVersion") || strings.Contains(s, `"-"`) {
		t.Errorf("shell blob = %s, must NOT serialize the schema version field", s)
	}
}

func TestUnmarshalExerciseContent_V1CountsFromPopulatedBlob(t *testing.T) {
	blob := []byte(`{
		"sections": [
			{"type":"reading","title":"S1","content":"passage","questionGroups":[
				{"type":"multiple_choice","instructions":"pick","questions":[
					{"text":"q1","type":"mc","options":["a","b"],"correctAnswer":"a","acceptedVariants":[]},
					{"text":"q2","type":"mc","options":["a","b"],"correctAnswer":"b","acceptedVariants":[]}
				]}
			]},
			{"type":"grammar","title":"S2","content":"","questionGroups":[
				{"type":"fill_in_blank","instructions":"fill","questions":[
					{"text":"q3","type":"fib","options":[],"correctAnswer":"x","acceptedVariants":["X"]}
				]}
			]}
		],
		"settings": {"timeLimitEnabled":true,"timeLimitMinutes":30,"caseSensitive":true}
	}`)
	content, err := UnmarshalExerciseContent(blob, 1)
	if err != nil {
		t.Fatalf("unmarshal v1: %v", err)
	}
	if content.SchemaVersion != 1 {
		t.Errorf("hydrated version = %d, want 1 (from the column)", content.SchemaVersion)
	}
	if content.SectionCount() != 2 {
		t.Errorf("section count = %d, want 2", content.SectionCount())
	}
	if content.QuestionCount() != 3 {
		t.Errorf("question count = %d, want 3", content.QuestionCount())
	}
	if !content.Settings.TimeLimitEnabled || content.Settings.TimeLimitMinutes != 30 || !content.Settings.CaseSensitive {
		t.Errorf("settings = %+v, want the populated values", content.Settings)
	}
}

func TestUnmarshalExerciseContent_EmptyShellZeroCounts(t *testing.T) {
	content, err := UnmarshalExerciseContent([]byte(`{"sections":[],"settings":{}}`), 1)
	if err != nil {
		t.Fatalf("unmarshal shell: %v", err)
	}
	if content.SectionCount() != 0 || content.QuestionCount() != 0 {
		t.Errorf("counts = %d/%d, want 0/0", content.SectionCount(), content.QuestionCount())
	}
}

func TestUnmarshalExerciseContent_MalformedJSON_TypedErrorNotPanic(t *testing.T) {
	_, err := UnmarshalExerciseContent([]byte(`{"sections": [ not json`), 1)
	assertInvalidContent(t, err, 1)
}

func TestUnmarshalExerciseContent_NullBlob_TypedError(t *testing.T) {
	_, err := UnmarshalExerciseContent(nil, 1)
	assertInvalidContent(t, err, 1)
}

func TestUnmarshalExerciseContent_ZeroVersion_TypedError(t *testing.T) {
	_, err := UnmarshalExerciseContent([]byte(`{"sections":[]}`), 0)
	assertInvalidContent(t, err, 0)
}

func TestUnmarshalExerciseContent_UnknownVersion_TypedError(t *testing.T) {
	_, err := UnmarshalExerciseContent([]byte(`{"sections":[]}`), 99)
	assertInvalidContent(t, err, 99)
}

func assertInvalidContent(t *testing.T, err error, wantVersion int) {
	t.Helper()
	if err == nil {
		t.Fatal("expected a typed error, got nil")
	}
	var invalid InvalidExerciseContentError
	if !errors.As(err, &invalid) {
		t.Fatalf("error type = %T, want InvalidExerciseContentError (never a panic/untyped error)", err)
	}
	if invalid.Version != wantVersion {
		t.Errorf("error version = %d, want %d", invalid.Version, wantVersion)
	}
}
