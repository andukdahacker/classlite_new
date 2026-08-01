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

	"github.com/ducdo/classlite-api/internal/model"
)

// CurrentExerciseSchemaVersion is the production current version (v1). Exported
// for the callers that stamp it on write (worker AI-mapping, handler decode).
const CurrentExerciseSchemaVersion = 1

// currentExerciseSchemaVersion + exerciseUpgraders are the ACTIVE schema config
// the lazy-upgrade ladder dispatches through (Story 4.5). They default to the
// production truth — v1, EMPTY chain, so model.MigrateJSONB is a passthrough for
// every real row — and are overridable ONLY via OverrideExerciseSchemaForTest so
// the service-layer write-back test can register a synthetic v2 ladder WITHOUT
// shipping a speculative production v2 (Story 4.5 DISASTER 1). A future vN→vN+1
// story registers its real rung in the default map + a per-rung contract test
// (AC4). The `schema_version` COLUMN is the single source of truth that drives
// the dispatch. Never mutated by production code.
var (
	currentExerciseSchemaVersion = CurrentExerciseSchemaVersion
	exerciseUpgraders            = map[int]model.UpgradeFunc{}
)

// ActiveExerciseSchemaVersion returns the version the ladder currently upgrades
// TO — always CurrentExerciseSchemaVersion in production; a test may override it
// via OverrideExerciseSchemaForTest. The service stamps this on every write so a
// synthetic-v2 test and production (v1) share one write-back path.
func ActiveExerciseSchemaVersion() int { return currentExerciseSchemaVersion }

// ValidateExerciseUpgradeChain reports whether the active exercise upgrader chain
// covers every rung in [from, to) (and that the bounds are sane), running no
// transform and touching no row. The batch tool calls it once before sweeping so
// a missing rung fails as a clean pre-flight config error rather than surfacing
// per-row as a mislabeled "poison row" abort.
func ValidateExerciseUpgradeChain(from, to int) error {
	return model.ValidateChain(from, to, exerciseUpgraders)
}

// OverrideExerciseSchemaForTest installs a synthetic current version + upgrader
// chain and returns a restore func. TEST-ONLY (Story 4.5 AC1 service-layer
// write-back proof) — production code must never call it. Not concurrency-safe:
// call it on a single goroutine and defer the returned restore.
func OverrideExerciseSchemaForTest(current int, upgraders map[int]model.UpgradeFunc) func() {
	prevVersion, prevUpgraders := currentExerciseSchemaVersion, exerciseUpgraders
	currentExerciseSchemaVersion = current
	exerciseUpgraders = upgraders
	return func() {
		currentExerciseSchemaVersion = prevVersion
		exerciseUpgraders = prevUpgraders
	}
}

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
// the `schema_version` COLUMN (the single source of truth). It routes the blob
// through the shared model.MigrateJSONB ladder (Story 4.5) so a row stored at an
// older version is upgraded in-memory to CurrentExerciseSchemaVersion BEFORE the
// typed struct is returned — callers never see a legacy version (GO-7). The
// production chain is empty (v1 is a passthrough), so behavior is byte-identical
// to 4.1: a NULL/empty blob, version 0/<1, or a version ahead of current is a
// typed InvalidExerciseContentError (never a panic).
func UnmarshalExerciseContent(raw []byte, version int) (ExerciseContent, error) {
	if version < 1 || version > currentExerciseSchemaVersion {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  fmt.Sprintf("schema version out of range (accepted: 1..%d)", currentExerciseSchemaVersion),
		}
	}
	if len(raw) == 0 {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  "content blob is empty/NULL",
		}
	}
	upgraded, err := model.MigrateJSONB(raw, version, currentExerciseSchemaVersion, exerciseUpgraders)
	if err != nil {
		// A gap/out-of-range from the ladder surfaces on the same typed error
		// the corruption/untrusted-input mappers already expect.
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  err.Error(),
		}
	}
	var content ExerciseContent
	if err := json.Unmarshal(upgraded, &content); err != nil {
		return ExerciseContent{}, InvalidExerciseContentError{
			Version: version,
			Reason:  "malformed JSON: " + err.Error(),
		}
	}
	content.SchemaVersion = currentExerciseSchemaVersion
	if content.Sections == nil {
		content.Sections = []ExerciseSection{}
	}
	return content, nil
}
