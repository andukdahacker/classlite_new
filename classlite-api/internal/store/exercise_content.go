// Story 4.1 — the v1 `ExerciseContent` contract (architecture §JSONB, GO-7).
//
// This is the COMPLETE v1 shape, co-developed with Story 4.2 (the structured
// editor) and 4.3 (AI generation) — both WRITE into it, so the shape is decided
// here, not negotiated downstream. There is EXACTLY ONE physical shape stamped
// `schema_version = 1`: the top-level `Settings` object + `QuestionGroup.Type`/
// `Instructions` are part of v1 now (materialized at create), so no
// settings-less rows ever reach the 4.2 editor and the discriminator never lies
// to Story 4.5's lazy-upgrade machinery (Winston).
//
// The `schema_version` COLUMN is the single source of truth. It drives
// UnmarshalExerciseContent(raw, version); the struct's SchemaVersion field is
// `json:"-"` — hydrated from the column, NEVER serialized into the blob (no dual
// source). A NULL / 0 / unknown version or an unparseable blob is a typed error,
// never a panic.
//
// 4.1 declares the struct + type constants + the MaxContentBytes guard. The
// per-type SEMANTIC validation (ValidateExerciseContent) is Story 4.2.
package store

import (
	"encoding/json"
	"fmt"
)

// CurrentExerciseSchemaVersion is the only version 4.1 knows how to (de)serialize.
const CurrentExerciseSchemaVersion = 1

// MaxContentBytes caps the serialized `content` blob a create/update may persist
// (a DoS / accidental-giant-paste guard, co-developed for 4.2 autosave). The
// service enforces it before the write and maps an overflow to 413. 256 KiB is
// generous for a structured exercise while bounding the JSONB row size.
const MaxContentBytes = 256 * 1024

// Section types (full words per CQ-4 — never abbreviations). 4.1 declares the
// enum; 4.2 wires the per-type editor + validation.
const (
	SectionTypeReading    = "reading"
	SectionTypeListening  = "listening"
	SectionTypeWriting    = "writing"
	SectionTypeSpeaking   = "speaking"
	SectionTypeGrammar    = "grammar"
	SectionTypeVocabulary = "vocabulary"
)

// Question-group types (full words per CQ-4). 4.2 owns the per-type semantics.
const (
	QuestionGroupTypeMultipleChoice    = "multiple_choice"
	QuestionGroupTypeTrueFalseNotGiven = "true_false_not_given"
	QuestionGroupTypeFillInBlank       = "fill_in_blank"
	QuestionGroupTypeShortAnswer       = "short_answer"
	QuestionGroupTypeMatching          = "matching"
)

// ExerciseContent is the v1 JSONB `content` blob (GO-7 — typed struct, never
// map[string]interface{}). SchemaVersion is hydrated from the column and never
// serialized (json:"-" — no dual source).
type ExerciseContent struct {
	SchemaVersion int               `json:"-"`
	Sections      []ExerciseSection `json:"sections"`
	Settings      ExerciseSettings  `json:"settings"`
}

// ExerciseSection is one section of an exercise. `skill` is a classification
// facet on the parent exercise — a section's Type is independent of it (a
// "reading" exercise may carry a listening section). Content is the passage /
// prompt / stimulus text.
type ExerciseSection struct {
	Type           string          `json:"type"`
	Title          string          `json:"title"`
	Content        string          `json:"content"`
	QuestionGroups []QuestionGroup `json:"questionGroups"`
}

// QuestionGroup bundles questions sharing a type + instructions within a section.
type QuestionGroup struct {
	Type         string     `json:"type"`
	Instructions string     `json:"instructions"`
	Questions    []Question `json:"questions"`
}

// Question is a single item. Options is the choice list (multiple-choice /
// matching); CorrectAnswer + AcceptedVariants drive the Epic 5 grading engine.
type Question struct {
	Text             string   `json:"text"`
	Type             string   `json:"type"`
	Options          []string `json:"options"`
	CorrectAnswer    string   `json:"correctAnswer"`
	AcceptedVariants []string `json:"acceptedVariants"`
}

// ExerciseSettings is the top-level per-exercise settings object. Part of v1
// (materialized at create, default-on-write). Every FR-22 default coincides
// with the Go zero value (time-limit OFF, 0 minutes, case-INsensitive), so the
// false-zero-value trap is designed out — a zero-value struct IS the default.
// Hyphen/whitespace normalization is FIXED grading behavior (always-on, the
// Epic 5 engine), NOT a per-row toggle.
type ExerciseSettings struct {
	TimeLimitEnabled bool `json:"timeLimitEnabled"`
	TimeLimitMinutes int  `json:"timeLimitMinutes"`
	CaseSensitive    bool `json:"caseSensitive"`
}

// InvalidExerciseContentError is the typed error returned when a stored blob
// cannot be interpreted under its column version. Never a panic. A corrupt
// stored blob surfaces as a 500 (data corruption) via the default mapper arm;
// callers that decode UNTRUSTED input map it to a 422/413 themselves.
type InvalidExerciseContentError struct {
	Version int
	Reason  string
}

func (e InvalidExerciseContentError) Error() string {
	return fmt.Sprintf("invalid exercise content (schema_version=%d): %s", e.Version, e.Reason)
}

// NewExerciseContentShell builds the empty v1 shell created at minimal-metadata
// create time: zero sections + FR-22-default settings. The non-nil empty slice
// guarantees `"sections":[]` (never `null`) on marshal.
func NewExerciseContentShell() ExerciseContent {
	return ExerciseContent{
		SchemaVersion: CurrentExerciseSchemaVersion,
		Sections:      []ExerciseSection{},
		Settings:      ExerciseSettings{},
	}
}

// Marshal renders the content to JSONB bytes for an insert/update param. It
// guarantees a non-nil `sections` array so the persisted blob is always an
// object with `"sections":[]`, never a bare `null` section list.
func (c ExerciseContent) Marshal() ([]byte, error) {
	if c.Sections == nil {
		c.Sections = []ExerciseSection{}
	}
	raw, err := json.Marshal(c)
	if err != nil {
		return nil, fmt.Errorf("marshal exercise content: %w", err)
	}
	return raw, nil
}

// SectionCount reports the number of sections (detail-path count — the list
// path computes this in SQL, T3).
func (c ExerciseContent) SectionCount() int {
	return len(c.Sections)
}

// QuestionCount reports the total questions across all sections' question
// groups (detail-path count — the list path computes this in SQL, T3).
func (c ExerciseContent) QuestionCount() int {
	total := 0
	for _, s := range c.Sections {
		for _, qg := range s.QuestionGroups {
			total += len(qg.Questions)
		}
	}
	return total
}

// UnmarshalExerciseContent decodes a raw JSONB blob under the version taken from
// the `schema_version` COLUMN (the single source of truth). v1 unmarshals
// directly; a NULL/empty blob, version 0, or an unknown version is a typed
// error (never a panic). The full lazy-upgrade dispatch for future versions is
// Story 4.5 — 4.1 knows only v1.
func UnmarshalExerciseContent(raw []byte, version int) (ExerciseContent, error) {
	if version != CurrentExerciseSchemaVersion {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  "unknown schema version (4.1 supports v1 only)",
		}
	}
	if len(raw) == 0 {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  "content blob is empty/NULL",
		}
	}
	var content ExerciseContent
	if err := json.Unmarshal(raw, &content); err != nil {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  "malformed JSON: " + err.Error(),
		}
	}
	content.SchemaVersion = version
	if content.Sections == nil {
		content.Sections = []ExerciseSection{}
	}
	return content, nil
}
