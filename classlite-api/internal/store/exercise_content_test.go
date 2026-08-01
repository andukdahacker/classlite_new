// Story 4.1 — v1 ExerciseContent contract units (T6 / AC6). No DB: pure
// (de)serialization + version-dispatch + count behavior. The version-dispatch
// negative cases (NULL/0/unknown) MUST be typed errors, never panics.
package store

import (
	"encoding/json"
	"errors"
	"strings"
	"testing"

	"github.com/ducdo/classlite-api/internal/model"
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

// TestUnmarshalExerciseContent_ColumnDrivesDispatchNotBlobField (Story 4.5, AC3)
// proves the COLUMN version — not a stray in-blob `schemaVersion` field — drives
// dispatch. A v1 row whose blob carries a bogus `"schemaVersion":2` must still be
// treated as v1 (the struct field is json:"-", so the stray field is ignored and
// the column wins). A false read of 2 would upgrade past current and error.
func TestUnmarshalExerciseContent_ColumnDrivesDispatchNotBlobField(t *testing.T) {
	raw := []byte(`{"schemaVersion":2,"sections":[],"settings":{}}`)
	content, err := UnmarshalExerciseContent(raw, CurrentExerciseSchemaVersion)
	if err != nil {
		t.Fatalf("column-sourced v1 decode with a stray blob field: %v", err)
	}
	if content.SchemaVersion != CurrentExerciseSchemaVersion {
		t.Fatalf("SchemaVersion = %d, want %d (column drives dispatch, not the blob)",
			content.SchemaVersion, CurrentExerciseSchemaVersion)
	}
}

// TestMigrateJSONB_GenericOverAnySecondEntity (Story 4.5, AC3) proves the ladder
// is generic over ANY JSONB column, not just exercises — a synthetic SECOND
// entity type run straight through model.MigrateJSONB, with no exercises/onboarding
// production path rewired. This is the genericity proof the story asks for at the
// store boundary (exercises is the only live consumer, but the engine is general).
func TestMigrateJSONB_GenericOverAnySecondEntity(t *testing.T) {
	type widgetV1 struct {
		Label string `json:"label"`
	}
	type widgetV2 struct {
		Label  string `json:"label"`
		Slug   string `json:"slug"`
		Schema int    `json:"schemaVersion"`
	}
	const widgetCurrent = 2
	upgraders := map[int]model.UpgradeFunc{
		1: func(in json.RawMessage) (json.RawMessage, error) {
			var w widgetV1
			if err := json.Unmarshal(in, &w); err != nil {
				return nil, err
			}
			return json.Marshal(widgetV2{Label: w.Label, Slug: strings.ToLower(w.Label), Schema: widgetCurrent})
		},
	}
	out, err := model.MigrateJSONB(json.RawMessage(`{"label":"HELLO"}`), 1, widgetCurrent, upgraders)
	if err != nil {
		t.Fatalf("generic second-entity migrate: %v", err)
	}
	var got widgetV2
	if err := json.Unmarshal(out, &got); err != nil {
		t.Fatalf("unmarshal widget v2: %v", err)
	}
	if (got != widgetV2{Label: "HELLO", Slug: "hello", Schema: widgetCurrent}) {
		t.Fatalf("second-entity upgrade = %+v, want label preserved + slug derived", got)
	}
}
